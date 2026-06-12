import type { KVNamespace } from 'hono-crud/internal';
import { buildCacheEntry, isCacheEntryExpired, normalizeStoredEntry } from '../entry';
import type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from '../types';

const KV_BATCH_CONCURRENCY = 50;

async function runBatched<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += KV_BATCH_CONCURRENCY) {
    await Promise.all(items.slice(i, i + KV_BATCH_CONCURRENCY).map(fn));
  }
}

/**
 * Options for Cloudflare KV cache storage.
 */
export interface KVCacheStorageOptions {
  /** KV namespace binding. */
  kv: KVNamespace;
  /** Key prefix for all cache entries. @default 'cache:' */
  prefix?: string;
  /** Default TTL in milliseconds. @default 300_000 */
  defaultTtlMs?: number;
}

/**
 * Cloudflare KV cache storage implementation.
 *
 * Uses KV's native TTL for expiration and stores tag indices as JSON arrays.
 * Best used with `createStorageMiddleware` since KV bindings are only
 * available inside request handlers.
 *
 * **Caveats:**
 * - Tag indices use read-modify-write (not atomic) — concurrent writes to
 *   the same tag may lose entries. Acceptable for cache invalidation.
 * - KV is eventually consistent (~60s stale reads possible).
 * - `deletePattern()` uses KV `list()` which may be slow for large keyspaces.
 * - Cloudflare KV requires `expirationTtl >= 60s`; TTLs below that floor are
 *   silently raised to 60 seconds (a platform constraint, not configurable).
 *
 * @example
 * ```ts
 * import { KVCacheStorage } from '@hono-crud/cache';
 * import { createStorageMiddleware } from 'hono-crud/storage';
 *
 * app.use('*', async (c, next) => {
 *   const cacheStorage = new KVCacheStorage({ kv: c.env.CACHE_KV });
 *   return createStorageMiddleware({ cacheStorage })(c, next);
 * });
 * ```
 */
export class KVCacheStorage implements CacheStorage {
  private kv: KVNamespace;
  private prefix: string;
  private defaultTtlMs: number;

  private stats: CacheStats = { hits: 0, misses: 0, size: 0 };

  constructor(options: KVCacheStorageOptions) {
    this.kv = options.kv;
    this.prefix = options.prefix ?? 'cache:';
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private getTagKey(tag: string): string {
    return `${this.prefix}_tag:${tag}`;
  }

  /**
   * Convert a millisecond TTL to KV's whole-second `expirationTtl`. Cloudflare
   * KV enforces a 60-second minimum, so sub-60s TTLs are silently floored.
   */
  private getExpirationTtl(ttlMs: number): number {
    return Math.max(60, Math.ceil(ttlMs / 1000));
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.kv.get(this.getKey(key));
    if (!raw) {
      this.stats.misses++;
      return null;
    }

    try {
      const entry = normalizeStoredEntry(JSON.parse(raw) as CacheEntry<T>);

      // Check expiration (KV TTL handles this, but guard against clock skew)
      if (isCacheEntryExpired(entry)) {
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

  async set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void> {
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;
    const tags = options?.tags;
    const now = Date.now();

    const entry = buildCacheEntry(data, ttlMs, tags, now);

    const kvOptions = ttlMs > 0 ? { expirationTtl: this.getExpirationTtl(ttlMs) } : undefined;
    await this.kv.put(this.getKey(key), JSON.stringify(entry), kvOptions);

    // Update tag indices
    if (tags) {
      await runBatched(tags, async (tag) => {
        const tagKey = this.getTagKey(tag);
        const existing = await this.kv.get(tagKey);
        const keys: string[] = existing ? JSON.parse(existing) : [];
        if (!keys.includes(key)) {
          keys.push(key);
          // Tag indices expire after 24h to prevent unbounded growth
          await this.kv.put(tagKey, JSON.stringify(keys), { expirationTtl: 86400 });
        }
      });
    }
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.getKey(key);

    // Clean up tags
    const raw = await this.kv.get(fullKey);
    if (raw) {
      try {
        const entry = JSON.parse(raw) as CacheEntry<unknown>;
        if (entry.tags) {
          await runBatched(entry.tags, async (tag) => {
            const tagKey = this.getTagKey(tag);
            const existing = await this.kv.get(tagKey);
            if (!existing) return;
            const keys: string[] = JSON.parse(existing);
            const filtered = keys.filter((k) => k !== key);
            if (filtered.length > 0) {
              await this.kv.put(tagKey, JSON.stringify(filtered), { expirationTtl: 86400 });
            } else {
              await this.kv.delete(tagKey);
            }
          });
        }
      } catch {
        // Ignore parse errors
      }
    }

    await this.kv.delete(fullKey);
    return raw !== null;
  }

  async deletePattern(pattern: string): Promise<number> {
    // Convert glob pattern to prefix for KV list
    const prefixEnd = pattern.indexOf('*');
    const searchPrefix =
      prefixEnd >= 0 ? this.getKey(pattern.substring(0, prefixEnd)) : this.getKey(pattern);

    let count = 0;
    let cursor: string | undefined;

    do {
      const result = await this.kv.list({
        prefix: searchPrefix,
        limit: 100,
        cursor,
      });

      const keys = result.keys.map(({ name }) => name.substring(this.prefix.length));
      await runBatched(keys, (k) => this.delete(k));
      count += keys.length;

      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return count;
  }

  async deleteByTag(tag: string): Promise<number> {
    const tagKey = this.getTagKey(tag);
    const existing = await this.kv.get(tagKey);
    if (!existing) return 0;

    const keys: string[] = JSON.parse(existing);
    await runBatched(keys, (k) => this.kv.delete(this.getKey(k)));
    await this.kv.delete(tagKey);
    return keys.length;
  }

  async has(key: string): Promise<boolean> {
    const raw = await this.kv.get(this.getKey(key));
    return raw !== null;
  }

  async clear(): Promise<void> {
    await this.deletePattern('*');
    this.stats = { hits: 0, misses: 0, size: 0 };
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }
}
