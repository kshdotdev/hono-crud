/**
 * Adapter-authoring entrypoint for first-party `@hono-crud/*` packages.
 *
 * This re-exports the full public API plus a small set of internal building
 * blocks (endpoint primitives, cursor helpers, the `AdapterBundle` contract)
 * that adapter packages need to implement storage backends. It is NOT part of
 * the stable public API and may change between minor versions — application
 * code should import from `hono-crud` instead.
 */

export * from './index';

// Cursor codecs and shared meta types not surfaced on the public barrel.
export { encodeCursor, decodeCursor } from './core/cursor';
export type { MetaInput } from './core/types';

// The model shape adapters operate on.
export type { ModelObject } from './endpoints/types';

// The contract adapter bundles implement, plus the generated-endpoints map.
export type { AdapterBundle, GeneratedEndpoints } from './config/index';

// App-scoped CRUD resource registry — lets addons enumerate registerCrud(...) calls.
export { getRegisteredCrudResources } from './core/resource-registry';
export type { RegisteredCrudResource } from './core/resource-registry';

// Version-history endpoint primitives (not on the public barrel).
export {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from './endpoints/version-history';

// Primitives for first-party middleware packages (cache, rate-limit, …).
export { ApiException, ConfigurationException } from './core/exceptions';
export { getContextVar, setContextVar } from './core/context-helpers';
export { CONTEXT_KEYS } from './core/context-keys';
export type { ContextKey } from './core/context-keys';
export { createStorageFeature } from './storage/feature';
export type { StorageFeature, StorageFeatureOptions } from './storage/feature';
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
} from './storage/contracts';
export type { Constructor } from './core/types';
export type { KVNamespace } from './shared/cloudflare-kv-types';
export { matchPath, matchAny, isPathIncluded } from './utils/path-match';
export type { PathPattern } from './utils/path-match';
export { getClientIp } from './utils/request-info';
export type { ClientIpOptions } from './utils/request-info';
export { defaultExtractToken as extractBearerToken } from './auth/middleware/jwt';
