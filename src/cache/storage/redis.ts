import type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from '../types';
import { getLogger } from '../../core/logger';

/**
 * Redis client interface.
 * Compatible with @upstash/redis and ioredis.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
  scan?(cursor: number | string, options?: { match?: string; count?: number }): Promise<[string, string[]]>;
  sadd?(key: string, ...members: string[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  srem?(key: string, ...members: string[]): Promise<number>;
  flushdb?(): Promise<string>;
}

/**
 * Options for Redis cache storage.
 */
export interface RedisCacheStorageOptions {
  /** Redis client instance. */
  client: RedisClient;
  /** Key prefix for all cache entries. @default 'cache:' */
  prefix?: string;
  /** Default TTL in seconds. @default 300 */
  defaultTtl?: number;
  /** Use SCAN instead of KEYS for pattern deletion (recommended for production). @default true */
  useScan?: boolean;
  /** SCAN count per iteration. @default 100 */
  scanCount?: number;
}

/**
 * Redis cache storage implementation.
 * Compatible with @upstash/redis (edge) and ioredis.
 *
 * Features:
 * - Native Redis TTL for expiration
 * - SCAN-based pattern deletion (production-safe)
 * - Redis Sets for tag tracking
 * - Edge-compatible with Upstash Redis
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis';
 * import { RedisCacheStorage, setCacheStorage } from 'hono-crud/cache';
 *
 * const cache = new RedisCacheStorage({
 *   client: new Redis({
 *     url: process.env.REDIS_URL,
 *     token: process.env.REDIS_TOKEN,
 *   }),
 * });
 * setCacheStorage(cache);
 * ```
 *
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { RedisCacheStorage, setCacheStorage } from 'hono-crud/cache';
 *
 * const cache = new RedisCacheStorage({
 *   client: new Redis(process.env.REDIS_URL),
 * });
 * setCacheStorage(cache);
 * ```
 */
export class RedisCacheStorage implements CacheStorage {
  private client: RedisClient;
  private prefix: string;
  private defaultTtl: number;
  private useScan: boolean;
  private scanCount: number;

  /** Statistics (local counter, not persisted) */
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0, // Approximate, not accurate for Redis
  };

  constructor(options: RedisCacheStorageOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'cache:';
    this.defaultTtl = options.defaultTtl ?? 300;
    this.useScan = options.useScan ?? true;
    this.scanCount = options.scanCount ?? 100;
  }

  /**
   * Get the full key with prefix.
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Get the tag set key.
   */
  private getTagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`;
  }

  /**
   * Get a cached entry by key.
   */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const fullKey = this.getKey(key);
    const value = await this.client.get(fullKey);

    if (!value) {
      this.stats.misses++;
      return null;
    }

    try {
      const entry = JSON.parse(value) as CacheEntry<T>;

      // Convert date strings back to Date objects
      entry.createdAt = new Date(entry.createdAt);
      if (entry.expiresAt) {
        entry.expiresAt = new Date(entry.expiresAt);
      }

      // Redis handles TTL, but check just in case
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return entry;
    } catch {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set a cache entry.
   */
  async set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void> {
    const fullKey = this.getKey(key);
    const ttl = options?.ttl ?? this.defaultTtl;
    const tags = options?.tags;

    const entry: CacheEntry<T> = {
      data,
      createdAt: new Date(),
      expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
      tags,
    };

    const value = JSON.stringify(entry);

    // Set with TTL
    if (ttl > 0) {
      await this.client.set(fullKey, value, { ex: ttl });
    } else {
      await this.client.set(fullKey, value);
    }

    // Update tag index
    if (tags && this.client.sadd) {
      for (const tag of tags) {
        await this.client.sadd(this.getTagKey(tag), key);
      }
    }
  }

  /**
   * Delete a cache entry by key.
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.getKey(key);

    // Get entry to clean up tags
    const value = await this.client.get(fullKey);
    if (value && this.client.srem) {
      try {
        const entry = JSON.parse(value) as CacheEntry<unknown>;
        if (entry.tags) {
          for (const tag of entry.tags) {
            await this.client.srem(this.getTagKey(tag), key);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    const count = await this.client.del(fullKey);
    return count > 0;
  }

  /**
   * Delete entries matching a glob-style pattern.
   */
  async deletePattern(pattern: string): Promise<number> {
    const fullPattern = this.getKey(pattern);
    const keys = await this.getKeysByPattern(fullPattern);

    if (keys.length === 0) {
      return 0;
    }

    // Extract original keys (without prefix) for tag cleanup
    const originalKeys = keys.map((k) => k.substring(this.prefix.length));

    // Clean up tags for each key
    for (const key of originalKeys) {
      const value = await this.client.get(this.getKey(key));
      if (value && this.client.srem) {
        try {
          const entry = JSON.parse(value) as CacheEntry<unknown>;
          if (entry.tags) {
            for (const tag of entry.tags) {
              await this.client.srem(this.getTagKey(tag), key);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Delete in batches
    const batchSize = 100;
    let count = 0;

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      count += await this.client.del(...batch);
    }

    return count;
  }

  /**
   * Delete all entries with a specific tag.
   */
  async deleteByTag(tag: string): Promise<number> {
    if (!this.client.smembers) {
      // Fallback to pattern if SMEMBERS not available
      return this.deletePattern(`*:tag=${tag}*`);
    }

    const tagKey = this.getTagKey(tag);
    const keys = await this.client.smembers(tagKey);

    if (keys.length === 0) {
      return 0;
    }

    let count = 0;

    // Delete each key
    for (const key of keys) {
      const deleted = await this.delete(key);
      if (deleted) {
        count++;
      }
    }

    // Delete the tag set itself
    await this.client.del(tagKey);

    return count;
  }

  /**
   * Check if a key exists in the cache.
   */
  async has(key: string): Promise<boolean> {
    const fullKey = this.getKey(key);
    const count = await this.client.exists(fullKey);
    return count > 0;
  }

  /**
   * Clear all cache entries (with this prefix).
   */
  async clear(): Promise<void> {
    // Delete all keys with our prefix
    await this.deletePattern('*');

    // Reset stats
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.size = 0;
  }

  /**
   * Get cache statistics.
   * Note: size is not accurate for Redis.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get keys matching a pattern using SCAN or KEYS.
   */
  private async getKeysByPattern(pattern: string): Promise<string[]> {
    if (this.useScan && this.client.scan) {
      return this.scanKeys(pattern);
    }

    if (this.client.keys) {
      return this.client.keys(pattern);
    }

    // Neither SCAN nor KEYS available
    getLogger().warn('Redis client does not support SCAN or KEYS. Pattern deletion not available.');
    return [];
  }

  /**
   * Scan keys matching a pattern (production-safe).
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    if (!this.client.scan) {
      return [];
    }

    const keys: string[] = [];
    let cursor: string = '0';

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, {
        match: pattern,
        count: this.scanCount,
      });
      cursor = String(nextCursor);
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
