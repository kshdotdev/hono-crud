import type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from '../types';
import type { KVNamespace } from '../../shared/kv-types';

/**
 * Options for Cloudflare KV cache storage.
 */
export interface KVCacheStorageOptions {
  /** KV namespace binding. */
  kv: KVNamespace;
  /** Key prefix for all cache entries. @default 'cache:' */
  prefix?: string;
  /** Default TTL in seconds. @default 300 */
  defaultTtl?: number;
}

/**
 * Cloudflare KV cache storage implementation.
 *
 * Uses KV's native TTL for expiration and stores tag indices as JSON arrays.
 * Best used with the `createCrudMiddleware` since KV bindings are only
 * available inside request handlers.
 *
 * **Caveats:**
 * - Tag indices use read-modify-write (not atomic) — concurrent writes to
 *   the same tag may lose entries. Acceptable for cache invalidation.
 * - KV is eventually consistent (~60s stale reads possible).
 * - `deletePattern()` uses KV `list()` which may be slow for large keyspaces.
 *
 * @example
 * ```ts
 * import { KVCacheStorage, createCrudMiddleware } from 'hono-crud';
 *
 * app.use('*', async (c, next) => {
 *   const cache = new KVCacheStorage({ kv: c.env.CACHE_KV });
 *   return createCrudMiddleware({ cache })(c, next);
 * });
 * ```
 */
export class KVCacheStorage implements CacheStorage {
  private kv: KVNamespace;
  private prefix: string;
  private defaultTtl: number;

  private stats: CacheStats = { hits: 0, misses: 0, size: 0 };

  constructor(options: KVCacheStorageOptions) {
    this.kv = options.kv;
    this.prefix = options.prefix ?? 'cache:';
    this.defaultTtl = options.defaultTtl ?? 300;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private getTagKey(tag: string): string {
    return `${this.prefix}_tag:${tag}`;
  }

  private getExpirationTtl(ttl: number): number {
    return Math.max(60, ttl);
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.kv.get(this.getKey(key));
    if (!raw) {
      this.stats.misses++;
      return null;
    }

    try {
      const entry = JSON.parse(raw) as CacheEntry<T>;

      // Check expiration (KV TTL handles this, but guard against clock skew)
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
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
    const ttl = options?.ttl ?? this.defaultTtl;
    const tags = options?.tags;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      createdAt: now,
      expiresAt: ttl > 0 ? now + ttl * 1000 : null,
      tags,
    };

    const kvOptions = ttl > 0 ? { expirationTtl: this.getExpirationTtl(ttl) } : undefined;
    await this.kv.put(this.getKey(key), JSON.stringify(entry), kvOptions);

    // Update tag indices
    if (tags) {
      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        const existing = await this.kv.get(tagKey);
        const keys: string[] = existing ? JSON.parse(existing) : [];
        if (!keys.includes(key)) {
          keys.push(key);
          // Tag indices expire after 24h to prevent unbounded growth
          await this.kv.put(tagKey, JSON.stringify(keys), { expirationTtl: 86400 });
        }
      }
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
          for (const tag of entry.tags) {
            const tagKey = this.getTagKey(tag);
            const existing = await this.kv.get(tagKey);
            if (existing) {
              const keys: string[] = JSON.parse(existing);
              const filtered = keys.filter((k) => k !== key);
              if (filtered.length > 0) {
                await this.kv.put(tagKey, JSON.stringify(filtered), { expirationTtl: 86400 });
              } else {
                await this.kv.delete(tagKey);
              }
            }
          }
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
    const searchPrefix = prefixEnd >= 0
      ? this.getKey(pattern.substring(0, prefixEnd))
      : this.getKey(pattern);

    let count = 0;
    let cursor: string | undefined;

    do {
      const result = await this.kv.list({
        prefix: searchPrefix,
        limit: 100,
        cursor,
      });

      for (const { name } of result.keys) {
        const originalKey = name.substring(this.prefix.length);
        await this.delete(originalKey);
        count++;
      }

      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return count;
  }

  async deleteByTag(tag: string): Promise<number> {
    const tagKey = this.getTagKey(tag);
    const existing = await this.kv.get(tagKey);
    if (!existing) return 0;

    const keys: string[] = JSON.parse(existing);
    let count = 0;

    for (const key of keys) {
      await this.kv.delete(this.getKey(key));
      count++;
    }

    await this.kv.delete(tagKey);
    return count;
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
