import type { IdempotencyEntry, IdempotencyStorage } from '../types';

/**
 * Minimal structural Redis client interface for idempotency storage.
 *
 * Deliberately NOT the cache package's `RedisClient`: idempotency locks need
 * `set()` to accept `{ nx, px }` (the object-options form used by
 * `@upstash/redis`) so lock acquisition is ONE atomic `SET key value NX PX ttl`
 * round-trip — cache's client cannot express `NX`. Compatible with
 * `@upstash/redis` natively; for `ioredis` (positional `'PX', ttl, 'NX'` args)
 * wrap the client with a 3-line adapter.
 */
export interface RedisIdempotencyClient {
  /** Get a string value (null when the key does not exist / expired). */
  get(key: string): Promise<string | null>;
  /**
   * Set a string value. `px` = TTL in milliseconds; `nx` = only set if the
   * key does NOT already exist (the atomic compare-and-set the lock relies
   * on). Must resolve to a non-null value (`'OK'`) on success and `null`
   * when `nx` prevented the write.
   */
  set(key: string, value: string, options?: { px?: number; nx?: boolean }): Promise<unknown>;
  /** Delete keys; returns the number deleted. */
  del(...keys: string[]): Promise<number>;
  /** Count how many of the given keys exist. */
  exists(...keys: string[]): Promise<number>;
}

/**
 * Options for Redis idempotency storage.
 */
export interface RedisIdempotencyStorageOptions {
  /** Redis client instance. */
  client: RedisIdempotencyClient;
  /**
   * Key prefix for all entries and locks. The storage owns this namespace:
   * the idempotency middleware adds no feature prefix of its own (keys arrive
   * as `<userId>:<idempotencyKey>`), the physical store may be shared, and
   * the adapter must segregate response entries from lock keys
   * (`<prefix><key>` vs `<prefix>lock:<key>`).
   * @default 'idem:'
   */
  prefix?: string;
}

/**
 * Redis idempotency storage implementation.
 * Compatible with `@upstash/redis` (edge) out of the box.
 *
 * Semantics:
 * - Entries: `SET <prefix><key> <json> PX <ttlMs>` — Redis owns expiry.
 * - Locks: `SET <prefix>lock:<key> '1' NX PX <ttlMs>` — a single atomic
 *   compare-and-set round-trip. This is the reason there is no Cloudflare KV
 *   backend: KV has no compare-and-swap, so a KV "lock" would be advisory
 *   only — a correctness footgun for the one feature whose failure mode is
 *   duplicate side effects (double charges).
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis';
 * import { RedisIdempotencyStorage } from '@hono-crud/idempotency';
 * import { createStorageMiddleware } from 'hono-crud/storage';
 *
 * app.use('*', async (c, next) => {
 *   const idempotencyStorage = new RedisIdempotencyStorage({
 *     client: new Redis({ url: c.env.REDIS_URL, token: c.env.REDIS_TOKEN }),
 *   });
 *   return createStorageMiddleware({ idempotencyStorage })(c, next);
 * });
 * ```
 */
export class RedisIdempotencyStorage implements IdempotencyStorage {
  private client: RedisIdempotencyClient;
  private prefix: string;

  constructor(options: RedisIdempotencyStorageOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'idem:';
  }

  /** Response-entry key. */
  private entryKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /** In-flight lock key (segregated from entries within the prefix). */
  private lockKey(key: string): string {
    return `${this.prefix}lock:${key}`;
  }

  async get(key: string): Promise<IdempotencyEntry | null> {
    const raw = await this.client.get(this.entryKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as IdempotencyEntry;
    } catch {
      // Corrupted payload — treat as absent rather than failing the request.
      return null;
    }
  }

  async set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void> {
    const value = JSON.stringify(entry);
    if (ttlMs > 0) {
      await this.client.set(this.entryKey(key), value, { px: Math.ceil(ttlMs) });
    } else {
      await this.client.set(this.entryKey(key), value);
    }
  }

  async isLocked(key: string): Promise<boolean> {
    return (await this.client.exists(this.lockKey(key))) > 0;
  }

  /**
   * Acquire the in-flight lock with ONE atomic `SET NX PX` round-trip.
   * Returns true when the lock was acquired; false when another request
   * holds it (Redis returns null for an NX miss).
   */
  async lock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(this.lockKey(key), '1', {
      nx: true,
      px: Math.max(1, Math.ceil(ttlMs)),
    });
    return result !== null && result !== undefined;
  }

  async unlock(key: string): Promise<void> {
    await this.client.del(this.lockKey(key));
  }
}
