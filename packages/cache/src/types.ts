/**
 * Cache storage contracts are owned by core (`storage/contracts.ts`) and
 * re-exported here so consumers can keep importing them from the cache plugin.
 * `CacheSetOptions.ttlMs` is milliseconds at the storage boundary; the
 * user-facing `CacheConfig.ttlSeconds` below stays in seconds for ergonomics.
 */
export type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from 'hono-crud/internal';

/**
 * Cache configuration for endpoints.
 */
export interface CacheConfig {
  /** Whether caching is enabled. @default true */
  enabled?: boolean;
  /** Time-to-live in seconds. @default 300 (5 min) */
  ttlSeconds?: number;
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
 * Invalidation strategy for mutation endpoints.
 */
export type InvalidationStrategy =
  | 'single' // Invalidate only the modified record
  | 'list' // Invalidate only list caches
  | 'all' // Invalidate all caches for this model
  | 'pattern' // Use custom pattern
  | 'tags'; // Invalidate by tags

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
