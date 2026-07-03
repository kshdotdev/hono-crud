/**
 * Cache storage contracts are owned by core (`storage/contracts.ts`) and
 * re-exported here so consumers can keep importing them from the cache plugin.
 * `CacheSetOptions.ttlMs` is milliseconds at the storage boundary; the
 * user-facing `CacheConfig.ttlSeconds` below stays in seconds for ergonomics.
 */
export type { CacheEntry, CacheSetOptions, CacheStats, CacheStorage } from 'hono-crud/internal';

/**
 * The cache config + key/invalidation types are owned by core so the config-API
 * cache path (`endpoints.{list,read}.cache`) and the `withCache` mixin share ONE
 * shape. Re-exported here so `@hono-crud/cache` keeps its full public type
 * surface without re-declaring (and drifting from) core.
 */
export type {
  CacheConfig,
  CacheInvalidationConfig,
  CacheKeyOptions,
  InvalidationPatternOptions,
  InvalidationStrategy,
} from 'hono-crud/internal';
