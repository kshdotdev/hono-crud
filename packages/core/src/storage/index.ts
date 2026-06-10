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

// Generic TTL Map store composed by the in-memory cache/rate-limit/idempotency backends
export { MemoryTtlStore } from './memory-ttl-store';
export type { MemoryTtlStoreOptions } from './memory-ttl-store';

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
