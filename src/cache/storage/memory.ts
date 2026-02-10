import type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from '../types';
import { matchesPattern } from '../key-generator';

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
  /** Main storage: key -> CacheEntry */
  private storage = new Map<string, CacheEntry>();

  /** Tag index: tag -> Set of keys */
  private tagIndex = new Map<string, Set<string>>();

  /** Statistics */
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
  };

  /** Default TTL in seconds */
  private defaultTtl: number;

  /** Maximum entries (0 = unlimited) */
  private maxEntries: number;

  constructor(options?: { defaultTtl?: number; maxEntries?: number }) {
    this.defaultTtl = options?.defaultTtl ?? 300; // 5 minutes
    this.maxEntries = options?.maxEntries ?? 10_000;
  }

  /**
   * Get a cached entry by key.
   * Returns null if not found or expired.
   */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.storage.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      // Entry has expired, delete it
      await this.delete(key);
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
    const ttl = options?.ttl ?? this.defaultTtl;
    const tags = options?.tags;

    // Evict if at capacity
    if (this.maxEntries > 0 && this.storage.size >= this.maxEntries && !this.storage.has(key)) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      data,
      createdAt: new Date(),
      expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
      tags,
    };

    // Remove old entry from tag index if exists
    const oldEntry = this.storage.get(key);
    if (oldEntry?.tags) {
      for (const tag of oldEntry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }

    // Add to storage
    this.storage.set(key, entry);
    this.stats.size = this.storage.size;

    // Update tag index
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
   * Delete a cache entry by key.
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.storage.get(key);

    if (!entry) {
      return false;
    }

    // Remove from tag index
    if (entry.tags) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }

    this.storage.delete(key);
    this.stats.size = this.storage.size;
    return true;
  }

  /**
   * Delete entries matching a glob-style pattern.
   */
  async deletePattern(pattern: string): Promise<number> {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.storage.keys()) {
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

    // Clean up empty tag set
    this.tagIndex.delete(tag);

    return count;
  }

  /**
   * Check if a key exists in the cache (and is not expired).
   */
  async has(key: string): Promise<boolean> {
    const entry = this.storage.get(key);

    if (!entry) {
      return false;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      await this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cache entries.
   */
  async clear(): Promise<void> {
    this.storage.clear();
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
    return Array.from(this.storage.keys());
  }

  /**
   * Get all tags (for debugging).
   */
  getTags(): string[] {
    return Array.from(this.tagIndex.keys());
  }

  /**
   * Evict oldest entry when at capacity.
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.storage.entries()) {
      const time = entry.createdAt.getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey).catch(() => {});
    }
  }

  /**
   * Clean up expired entries (manual garbage collection).
   */
  async cleanup(): Promise<number> {
    const now = new Date();
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.storage.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      await this.delete(key);
      count++;
    }

    return count;
  }
}
