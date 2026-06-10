import { MemoryTtlStore } from 'hono-crud/internal';
import { buildCacheEntry, isCacheEntryExpired } from '../entry';
import { matchesPattern } from '../key-generator';
import type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from '../types';

/**
 * In-memory cache storage implementation.
 * Ideal for development, testing, and single-instance deployments.
 *
 * Features:
 * - TTL expiration on read
 * - Tag-based invalidation
 * - Pattern-based deletion
 * - Hit/miss statistics
 *
 * @example
 * ```ts
 * import { MemoryCacheStorage, setCacheStorage } from 'hono-crud/cache';
 *
 * const cache = new MemoryCacheStorage();
 * setCacheStorage(cache);
 *
 * // Get stats
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses)}`);
 * ```
 */
export class MemoryCacheStorage implements CacheStorage {
  /** Generic TTL Map store: key -> CacheEntry (composed). */
  private store: MemoryTtlStore<CacheEntry>;

  /** Tag index: tag -> Set of keys */
  private tagIndex = new Map<string, Set<string>>();

  /** Statistics */
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
  };

  /** Default TTL in milliseconds */
  private defaultTtlMs: number;

  /** Maximum entries (0 = unlimited) */
  private maxEntries: number;

  constructor(options?: { defaultTtlMs?: number; maxEntries?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 300_000; // 5 minutes
    this.maxEntries = options?.maxEntries ?? 10_000;
    this.store = new MemoryTtlStore<CacheEntry>({
      isExpired: isCacheEntryExpired,
      maxEntries: this.maxEntries,
      onEvict: (key, entry) => this.removeFromTagIndex(key, entry),
    });
  }

  /**
   * Remove a key from every tag bucket it belongs to. Fired by the store's
   * `onEvict` on eviction/expiry-on-read/delete/overwrite (old value).
   */
  private removeFromTagIndex(key: string, entry: CacheEntry): void {
    if (entry.tags) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }
  }

  /**
   * Add a key to every tag bucket in `tags`.
   */
  private addToTagIndex(key: string, tags: string[] | undefined): void {
    if (tags) {
      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(key);
      }
    }
  }

  /**
   * Get a cached entry by key.
   * Returns null if not found or expired.
   */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    // Re-sync: expiry-on-read may have evicted the entry.
    this.stats.size = this.store.size;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry;
  }

  /**
   * Set a cache entry.
   */
  async set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void> {
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;
    const tags = options?.tags;

    const entry = buildCacheEntry(data, ttlMs, tags);

    // Overwrite re-tags via `refreshLruOnOverwrite` (fires `onEvict` for the old
    // value → removes stale tag entries) + moves the key to the newest position.
    this.store.set(key, entry, /* refreshLruOnOverwrite */ true);
    this.addToTagIndex(key, tags);
    this.stats.size = this.store.size;
  }

  /**
   * Delete a cache entry by key.
   */
  async delete(key: string): Promise<boolean> {
    const ok = this.store.delete(key);
    this.stats.size = this.store.size;
    return ok;
  }

  /**
   * Delete entries matching a glob-style pattern.
   */
  async deletePattern(pattern: string): Promise<number> {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.store.getKeys()) {
      if (matchesPattern(key, pattern)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const deleted = await this.delete(key);
      if (deleted) {
        count++;
      }
    }

    return count;
  }

  /**
   * Delete all entries with a specific tag.
   */
  async deleteByTag(tag: string): Promise<number> {
    const keys = this.tagIndex.get(tag);

    if (!keys || keys.size === 0) {
      return 0;
    }

    let count = 0;
    const keysToDelete = Array.from(keys);

    for (const key of keysToDelete) {
      const deleted = await this.delete(key);
      if (deleted) {
        count++;
      }
    }

    // Clean up empty tag set. `onEvict` → `removeFromTagIndex` only removes the
    // key from the Set, so the now-empty tag bucket must be dropped explicitly
    // to keep `getTags()` consistent.
    this.tagIndex.delete(tag);

    return count;
  }

  /**
   * Check if a key exists in the cache (and is not expired).
   */
  async has(key: string): Promise<boolean> {
    const ok = this.store.has(key);
    // Re-sync: expiry-on-read may have evicted the entry.
    this.stats.size = this.store.size;
    return ok;
  }

  /**
   * Clear all cache entries.
   */
  async clear(): Promise<void> {
    this.store.clear();
    this.tagIndex.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  /**
   * Get all keys (for debugging).
   */
  getKeys(): string[] {
    return this.store.getKeys();
  }

  /**
   * Get all tags (for debugging).
   */
  getTags(): string[] {
    return Array.from(this.tagIndex.keys());
  }

  /**
   * Clean up expired entries (manual garbage collection).
   */
  async cleanup(): Promise<number> {
    const n = this.store.cleanup();
    this.stats.size = this.store.size;
    return n;
  }
}
