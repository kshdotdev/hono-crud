/**
 * Cache entry stored in the cache storage.
 */
export interface CacheEntry<T = unknown> {
  data: T;
  /** Epoch milliseconds when the entry was created. */
  createdAt: number;
  /** Epoch milliseconds when the entry expires, or null for no expiration. */
  expiresAt: number | null;
  tags?: string[];
}

/**
 * Cache configuration for endpoints.
 */
export interface CacheConfig {
  /** Whether caching is enabled. @default true */
  enabled?: boolean;
  /** Time-to-live in seconds. @default 300 (5 min) */
  ttl?: number;
  /** Key prefix for cache entries. */
  prefix?: string;
  /** Query parameters to include in the cache key. */
  keyFields?: string[];
  /** Include userId in the cache key for per-user caching. */
  perUser?: boolean;
  /** Tags for group invalidation. */
  tags?: string[];
}

/**
 * Options for setting cache entries.
 */
export interface CacheSetOptions {
  /** Time-to-live in seconds. */
  ttl?: number;
  /** Tags for group invalidation. */
  tags?: string[];
}

/**
 * Cache storage interface.
 * Implement this interface for custom storage backends.
 */
export interface CacheStorage {
  /**
   * Get a cached entry by key.
   * @returns The cached entry or null if not found/expired.
   */
  get<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Set a cache entry.
   * @param key - The cache key.
   * @param data - The data to cache.
   * @param options - Cache options (ttl, tags).
   */
  set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Delete a cache entry by key.
   * @returns True if the entry was deleted.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete entries matching a glob-style pattern.
   * @param pattern - Glob pattern (e.g., "users:*").
   * @returns Number of deleted entries.
   */
  deletePattern(pattern: string): Promise<number>;

  /**
   * Delete all entries with a specific tag.
   * @param tag - The tag to match.
   * @returns Number of deleted entries.
   */
  deleteByTag?(tag: string): Promise<number>;

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all cache entries.
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics (optional).
   */
  getStats?(): CacheStats;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * Invalidation strategy for mutation endpoints.
 */
export type InvalidationStrategy =
  | 'single'   // Invalidate only the modified record
  | 'list'     // Invalidate only list caches
  | 'all'      // Invalidate all caches for this model
  | 'pattern'  // Use custom pattern
  | 'tags';    // Invalidate by tags

/**
 * Cache invalidation configuration.
 */
export interface CacheInvalidationConfig {
  /** Invalidation strategy. @default 'all' */
  strategy?: InvalidationStrategy;
  /** Custom pattern for 'pattern' strategy. */
  pattern?: string;
  /** Tags to invalidate for 'tags' strategy. */
  tags?: string[];
  /** Related models to also invalidate. */
  relatedModels?: string[];
}

/**
 * Options for cache key generation.
 */
export interface CacheKeyOptions {
  /** Table/model name. */
  tableName: string;
  /** HTTP method or operation type. */
  method: 'GET' | 'LIST';
  /** Path parameters. */
  params?: Record<string, string>;
  /** Query parameters. */
  query?: Record<string, unknown>;
  /** Which query fields to include in the key. */
  keyFields?: string[];
  /** User ID for per-user caching. */
  userId?: string;
  /** Key prefix. */
  prefix?: string;
}

/**
 * Options for creating invalidation patterns.
 */
export interface InvalidationPatternOptions {
  /** HTTP method to invalidate. */
  method?: 'GET' | 'LIST';
  /** Specific record ID to invalidate. */
  id?: string | number;
  /** User ID to invalidate (for per-user caches). */
  userId?: string;
}
