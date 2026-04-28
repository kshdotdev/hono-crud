import type {
  RateLimitStorage,
  FixedWindowEntry,
  SlidingWindowEntry,
  RateLimitEntry,
} from '../types';
import type { KVNamespace } from '../../shared/kv-types';

/**
 * Options for Cloudflare KV rate limit storage.
 */
export interface KVRateLimitStorageOptions {
  /** KV namespace binding. */
  kv: KVNamespace;
  /** Key prefix for all rate limit entries. @default 'rl:' */
  prefix?: string;
  /**
   * Whether KV read/write failures should allow the request to continue.
   * KV is best-effort for rate limits, so fail-open is the edge-safe default.
   * @default true
   */
  failOpen?: boolean;
  /** Called when a KV operation or stored payload fails. */
  onError?: (
    error: Error,
    context: { operation: 'increment' | 'addTimestamp' | 'get' | 'reset'; key: string }
  ) => void;
}

/**
 * Cloudflare KV rate limit storage implementation.
 *
 * **Important caveats:**
 * - KV is eventually consistent (~60s stale reads). Rate limiting is best-effort.
 * - Read-modify-write is not atomic — concurrent requests may race.
 * - KV allows only one write per second to the same key, so high-frequency
 *   counters can fail open or undercount.
 * - KV expirationTtl must be at least 60 seconds; shorter windows are enforced
 *   by app-level timestamps while the KV entry remains alive for 60 seconds.
 * - Fixed window algorithm is recommended over sliding window for KV.
 * - For strict rate limiting, use Durable Objects or Upstash Redis instead.
 *
 * Best used with `createCrudMiddleware` since KV bindings are only
 * available inside request handlers.
 *
 * @example
 * ```ts
 * import { KVRateLimitStorage, createCrudMiddleware } from 'hono-crud';
 *
 * app.use('*', async (c, next) => {
 *   const rateLimit = new KVRateLimitStorage({ kv: c.env.RATE_LIMIT_KV });
 *   return createCrudMiddleware({ rateLimit })(c, next);
 * });
 * ```
 */
export class KVRateLimitStorage implements RateLimitStorage {
  private kv: KVNamespace;
  private prefix: string;
  private failOpen: boolean;
  private onError?: KVRateLimitStorageOptions['onError'];

  constructor(options: KVRateLimitStorageOptions) {
    this.kv = options.kv;
    this.prefix = options.prefix ?? 'rl:';
    this.failOpen = options.failOpen ?? true;
    this.onError = options.onError;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private getExpirationTtl(windowMs: number): number {
    return Math.max(60, Math.ceil(windowMs / 1000));
  }

  private reportError(
    operation: 'increment' | 'addTimestamp' | 'get' | 'reset',
    key: string,
    error: unknown
  ): Error {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.onError?.(normalized, { operation, key });
    return normalized;
  }

  private parseJson(raw: string, operation: 'increment' | 'addTimestamp' | 'get', key: string): unknown | null {
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      this.reportError(operation, key, err);
      return null;
    }
  }

  private isFixedWindowEntry(value: unknown): value is FixedWindowEntry {
    if (value === null || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.count === 'number' && typeof record.windowStart === 'number';
  }

  private isSlidingWindowEntry(value: unknown): value is SlidingWindowEntry {
    if (value === null || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return Array.isArray(record.timestamps) && record.timestamps.every((item) => typeof item === 'number');
  }

  async increment(key: string, windowMs: number): Promise<FixedWindowEntry> {
    const fullKey = this.getKey(key);
    const now = Date.now();
    const ttl = this.getExpirationTtl(windowMs);
    const fallback: FixedWindowEntry = { count: 1, windowStart: now };

    try {
      const raw = await this.kv.get(fullKey);
      let entry: FixedWindowEntry;

      if (raw) {
        const parsed = this.parseJson(raw, 'increment', key);
        if (this.isFixedWindowEntry(parsed) && now - parsed.windowStart < windowMs) {
          entry = { count: parsed.count + 1, windowStart: parsed.windowStart };
        } else {
          entry = fallback;
        }
      } else {
        entry = fallback;
      }

      await this.kv.put(fullKey, JSON.stringify(entry), { expirationTtl: ttl });

      return entry;
    } catch (err) {
      const error = this.reportError('increment', key, err);
      if (!this.failOpen) throw error;
      return fallback;
    }
  }

  async addTimestamp(key: string, windowMs: number, now?: number): Promise<SlidingWindowEntry> {
    const fullKey = this.getKey(key);
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - windowMs;
    const ttl = this.getExpirationTtl(windowMs);
    const fallback: SlidingWindowEntry = { timestamps: [currentTime] };

    try {
      const raw = await this.kv.get(fullKey);
      let timestamps: number[];

      if (raw) {
        const parsed = this.parseJson(raw, 'addTimestamp', key);
        timestamps = this.isSlidingWindowEntry(parsed)
          ? parsed.timestamps.filter((t) => t > windowStart)
          : [];
        timestamps.push(currentTime);
      } else {
        timestamps = [currentTime];
      }

      const entry: SlidingWindowEntry = { timestamps };
      await this.kv.put(fullKey, JSON.stringify(entry), { expirationTtl: ttl });

      return entry;
    } catch (err) {
      const error = this.reportError('addTimestamp', key, err);
      if (!this.failOpen) throw error;
      return fallback;
    }
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    try {
      const raw = await this.kv.get(this.getKey(key));
      if (!raw) return null;

      const parsed = this.parseJson(raw, 'get', key);
      if (this.isFixedWindowEntry(parsed) || this.isSlidingWindowEntry(parsed)) {
        return parsed;
      }
      return null;
    } catch (err) {
      const error = this.reportError('get', key, err);
      if (!this.failOpen) throw error;
      return null;
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.kv.delete(this.getKey(key));
    } catch (err) {
      const error = this.reportError('reset', key, err);
      if (!this.failOpen) throw error;
    }
  }

  async cleanup(): Promise<number> {
    // KV handles TTL automatically
    return 0;
  }

  destroy(): void {
    // No cleanup needed — KV lifecycle is managed by the runtime
  }
}
