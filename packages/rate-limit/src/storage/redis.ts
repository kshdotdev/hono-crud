import type { RateLimitStorage, FixedWindowEntry, SlidingWindowEntry, RateLimitEntry } from '../types';

/**
 * Redis client interface for rate limiting.
 * Compatible with @upstash/redis and ioredis.
 */
export interface RedisRateLimitClient {
  /** Get a string value */
  get(key: string): Promise<string | null>;
  /** Set a string value with optional expiration */
  set(key: string, value: string, options?: { ex?: number; px?: number }): Promise<unknown>;
  /** Increment a value */
  incr(key: string): Promise<number>;
  /** Delete keys */
  del(...keys: string[]): Promise<number>;
  /** Set expiration in seconds */
  expire(key: string, seconds: number): Promise<number>;
  /** Set expiration in milliseconds */
  pexpire?(key: string, milliseconds: number): Promise<number>;
  /** Get TTL in seconds */
  ttl?(key: string): Promise<number>;
  /** Get TTL in milliseconds */
  pttl?(key: string): Promise<number>;
  /** Add to sorted set */
  zadd?(key: string, ...args: (string | number)[]): Promise<number>;
  /** Remove from sorted set by score range */
  zremrangebyscore?(key: string, min: string | number, max: string | number): Promise<number>;
  /** Count sorted set members in score range */
  zcount?(key: string, min: string | number, max: string | number): Promise<number>;
  /** Get sorted set members in score range */
  zrangebyscore?(key: string, min: string | number, max: string | number): Promise<string[]>;
  /** Execute Lua script (for atomic operations) */
  eval?(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

/**
 * Options for RedisRateLimitStorage.
 */
export interface RedisRateLimitStorageOptions {
  /** Redis client instance */
  client: RedisRateLimitClient;
  /** Key prefix for all rate limit entries @default 'ratelimit:' */
  prefix?: string;
}

// Lua script for atomic fixed window increment
const FIXED_WINDOW_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

local data = redis.call('GET', key)
if data then
  local entry = cjson.decode(data)
  local window_end = entry.windowStart + window_ms
  if now < window_end then
    entry.count = entry.count + 1
    redis.call('SET', key, cjson.encode(entry))
    redis.call('PEXPIRE', key, window_end - now)
    return cjson.encode(entry)
  end
end

local entry = {count = 1, windowStart = now}
redis.call('SET', key, cjson.encode(entry), 'PX', window_ms)
return cjson.encode(entry)
`;

// Lua script for atomic sliding window timestamp add
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window_start = now - window_ms

redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
redis.call('ZADD', key, now, now)
redis.call('PEXPIRE', key, window_ms)

local timestamps = redis.call('ZRANGEBYSCORE', key, window_start, '+inf')
return cjson.encode({timestamps = timestamps})
`;

/**
 * Redis rate limit storage implementation.
 * Compatible with @upstash/redis (edge) and ioredis.
 *
 * Features:
 * - Atomic operations using Lua scripts (when available)
 * - Fallback to non-atomic operations for basic Redis clients
 * - Sorted sets for efficient sliding window
 * - Edge-compatible with Upstash Redis
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis';
 * import { RedisRateLimitStorage, setRateLimitStorage } from 'hono-crud';
 *
 * const storage = new RedisRateLimitStorage({
 *   client: new Redis({
 *     url: c.env.REDIS_URL,
 *     token: c.env.REDIS_TOKEN,
 *   }),
 * });
 * setRateLimitStorage(storage);
 * ```
 *
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { RedisRateLimitStorage, setRateLimitStorage } from 'hono-crud';
 *
 * const storage = new RedisRateLimitStorage({
 *   client: new Redis(c.env.REDIS_URL),
 * });
 * setRateLimitStorage(storage);
 * ```
 */
export class RedisRateLimitStorage implements RateLimitStorage {
  private client: RedisRateLimitClient;
  private prefix: string;
  private hasLua: boolean | null = null;

  constructor(options: RedisRateLimitStorageOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'ratelimit:';
  }

  /**
   * Get the full key with prefix.
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Check if Lua scripting is available.
   */
  private async checkLuaSupport(): Promise<boolean> {
    if (this.hasLua !== null) {
      return this.hasLua;
    }

    if (!this.client.eval) {
      this.hasLua = false;
      return false;
    }

    try {
      await this.client.eval('return 1', [], []);
      this.hasLua = true;
    } catch {
      this.hasLua = false;
    }

    return this.hasLua;
  }

  /**
   * Increment the request count for a key (fixed window).
   */
  async increment(key: string, windowMs: number): Promise<FixedWindowEntry> {
    const fullKey = this.getKey(key);
    const now = Date.now();

    // Try Lua script for atomic operation
    if (await this.checkLuaSupport()) {
      try {
        const result = await this.client.eval!(
          FIXED_WINDOW_LUA,
          [fullKey],
          [windowMs, now]
        );
        const entry = typeof result === 'string' ? JSON.parse(result) : result;
        return entry as FixedWindowEntry;
      } catch {
        // Fall through to non-atomic implementation
      }
    }

    // Fallback: non-atomic implementation
    const existing = await this.get(key) as FixedWindowEntry | null;

    if (existing && 'count' in existing) {
      const windowEnd = existing.windowStart + windowMs;

      if (now < windowEnd) {
        // Within current window, increment
        existing.count++;
        const ttl = Math.ceil((windowEnd - now) / 1000);
        await this.client.set(fullKey, JSON.stringify(existing), { ex: ttl > 0 ? ttl : 1 });
        return existing;
      }
    }

    // Start new window
    const entry: FixedWindowEntry = {
      count: 1,
      windowStart: now,
    };

    const ttl = Math.ceil(windowMs / 1000);
    await this.client.set(fullKey, JSON.stringify(entry), { ex: ttl > 0 ? ttl : 1 });

    return entry;
  }

  /**
   * Add a timestamp to the sliding window for a key.
   */
  async addTimestamp(key: string, windowMs: number, now?: number): Promise<SlidingWindowEntry> {
    const fullKey = this.getKey(key);
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - windowMs;

    // Try sorted set operations if available
    if (this.client.zadd && this.client.zremrangebyscore && this.client.zrangebyscore) {
      // Try Lua script for atomic operation
      if (await this.checkLuaSupport()) {
        try {
          const result = await this.client.eval!(
            SLIDING_WINDOW_LUA,
            [fullKey],
            [windowMs, currentTime]
          );
          const entry = typeof result === 'string' ? JSON.parse(result) : result;
          // Ensure timestamps are numbers
          const timestamps = (entry.timestamps || []).map((t: string | number) => Number(t));
          return { timestamps };
        } catch {
          // Fall through to non-atomic implementation
        }
      }

      // Non-atomic sorted set implementation
      await this.client.zremrangebyscore(fullKey, '-inf', windowStart);
      await this.client.zadd(fullKey, currentTime, String(currentTime));

      const ttl = Math.ceil(windowMs / 1000);
      await this.client.expire(fullKey, ttl > 0 ? ttl : 1);

      const timestamps = await this.client.zrangebyscore(fullKey, windowStart, '+inf');

      return {
        timestamps: timestamps.map((t) => Number(t)),
      };
    }

    // Fallback: use JSON storage (less efficient)
    const existing = await this.get(key) as SlidingWindowEntry | null;

    let timestamps: number[];
    if (existing && 'timestamps' in existing) {
      timestamps = existing.timestamps.filter((t) => t > windowStart);
      timestamps.push(currentTime);
    } else {
      timestamps = [currentTime];
    }

    const entry: SlidingWindowEntry = { timestamps };
    const ttl = Math.ceil(windowMs / 1000);
    await this.client.set(fullKey, JSON.stringify(entry), { ex: ttl > 0 ? ttl : 1 });

    return entry;
  }

  /**
   * Get the current entry for a key.
   */
  async get(key: string): Promise<RateLimitEntry | null> {
    const fullKey = this.getKey(key);

    // Check if it's a sorted set (sliding window with zadd)
    if (this.client.zcount && this.client.zrangebyscore) {
      const count = await this.client.zcount(fullKey, '-inf', '+inf');
      if (count > 0) {
        const timestamps = await this.client.zrangebyscore(fullKey, '-inf', '+inf');
        return {
          timestamps: timestamps.map((t) => Number(t)),
        };
      }
    }

    // Try JSON storage (fixed window or fallback sliding window)
    const value = await this.client.get(fullKey);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as RateLimitEntry;
    } catch {
      return null;
    }
  }

  /**
   * Reset the rate limit for a key.
   */
  async reset(key: string): Promise<void> {
    const fullKey = this.getKey(key);
    await this.client.del(fullKey);
  }

  /**
   * Clean up expired entries.
   * Redis handles TTL automatically, so this is a no-op.
   */
  async cleanup(): Promise<number> {
    // Redis handles TTL automatically
    return 0;
  }

  /**
   * Destroy the storage.
   * No cleanup needed for Redis client (connection managed externally).
   */
  destroy(): void {
    // Connection lifecycle managed by the client owner
  }
}
