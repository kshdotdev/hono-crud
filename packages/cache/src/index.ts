// Types
export type {
  CacheEntry,
  CacheConfig,
  CacheSetOptions,
  CacheStorage,
  CacheStats,
  InvalidationStrategy,
  CacheInvalidationConfig,
  CacheKeyOptions,
  InvalidationPatternOptions,
} from './types';

// Key generation utilities
export {
  generateCacheKey,
  createInvalidationPattern,
  createRelatedPatterns,
  matchesPattern,
  parseCacheKey,
} from './key-generator';

// Storage implementations
export { MemoryCacheStorage } from './storage/memory';
export { RedisCacheStorage } from './storage/redis';
export type { RedisClient, RedisCacheStorageOptions } from './storage/redis';
export { KVCacheStorage } from './storage/cloudflare-kv';
export type { KVCacheStorageOptions } from './storage/cloudflare-kv';

// Mixins and global storage
export {
  withCache,
  withCacheInvalidation,
  setCacheStorage,
  getCacheStorage,
} from './mixin';
export type { CacheEndpointMethods, CacheInvalidationMethods } from './mixin';
