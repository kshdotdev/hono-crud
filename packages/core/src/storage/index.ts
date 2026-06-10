// Types
export type { StorageEnv, StorageMiddlewareConfig } from './types';

// Cross-package storage contracts (owned by core)
export type {
  CacheStorage,
  CacheEntry,
  CacheSetOptions,
  CacheStats,
  RateLimitStorage,
  FixedWindowEntry,
  SlidingWindowEntry,
  RateLimitEntry,
  IdempotencyStorage,
  IdempotencyEntry,
} from './contracts';

// Middleware
export {
  createStorageMiddleware,
  createLoggingStorageMiddleware,
  createAuditStorageMiddleware,
  createVersioningStorageMiddleware,
  createAPIKeyStorageMiddleware,
  createCacheStorageMiddleware,
  createRateLimitStorageMiddleware,
  createIdempotencyStorageMiddleware,
} from './middleware';

// Shared storage-feature helper
export { createStorageFeature } from './feature';
export type { StorageFeature, StorageFeatureOptions } from './feature';

// Helpers
export {
  getStorage,
  resolveLoggingStorage,
  resolveAuditStorage,
  resolveVersioningStorage,
  resolveAPIKeyStorage,
  getLoggingStorageRequired,
  getAuditStorageRequired,
  getVersioningStorageRequired,
} from './helpers';

// Registry
export {
  StorageRegistry,
  createNullableRegistry,
  createRegistryWithDefault,
} from './registry';
