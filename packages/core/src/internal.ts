/**
 * Adapter-authoring entrypoint for first-party `@hono-crud/*` packages.
 *
 * An explicit, curated list of the building blocks (endpoint primitives,
 * cursor helpers, storage contracts, the `AdapterBundle` contract) that
 * adapter and middleware packages need to implement storage backends and
 * core extensions. First-party satellites import ONLY from this entrypoint.
 * It is NOT part of the stable public API and may change between minor
 * versions — application code should import from `hono-crud` or a
 * `hono-crud/<feature>` subpath instead.
 */

// ============================================================================
// Model & meta foundation
// ============================================================================

// The meta contract endpoints are generic over, and the model shape adapters
// operate on (`Row` always derives from the consumer's Zod schema).
export type { Constructor, MetaInput } from './core/types';
export type { ModelObject } from './endpoints/types';

// ============================================================================
// Core types shared with adapters
// ============================================================================

export { assertNever, isFilterOperator } from './core/types';
export type {
  AggregateField,
  AggregateOptions,
  AggregateResult,
  ErrorResponse,
  FilterCondition,
  FilterOperator,
  IncludeOptions,
  ListFilters,
  NestedUpdateInput,
  NestedWriteResult,
  OpenAPIRouteSchema,
  PaginatedResult,
  RelationConfig,
  RelationsConfig,
  ResponseEnvelopeInfo,
  SearchOptions,
  SearchResult,
  SearchResultItem,
} from './core/types';

// ============================================================================
// Route & registrar primitives
// ============================================================================

export { OpenAPIRoute } from './core/route';
export type { CrudEndpointName, CrudEndpoints } from './core/register';

// Canonical CRUD route table: [endpoint name, HTTP verb, sub-path] rows in
// registration order — the single source of truth registerCrud iterates.
export { CRUD_ROUTES } from './core/crud-routes';

// App-scoped CRUD resource registry — lets addons enumerate registerCrud(...) calls.
export { getRegisteredCrudResources } from './core/resource-registry';
export type { RegisteredCrudResource } from './core/resource-registry';

// ============================================================================
// Endpoint primitives (the classes adapters extend) + their result types
// ============================================================================

export { CreateEndpoint } from './endpoints/create';
export { ReadEndpoint } from './endpoints/read';
export { UpdateEndpoint } from './endpoints/update';
export { DeleteEndpoint } from './endpoints/delete';
export type { CascadeResult } from './endpoints/delete';
export { ListEndpoint } from './endpoints/list';
export { RestoreEndpoint } from './endpoints/restore';
export { CloneEndpoint } from './endpoints/clone';
export { UpsertEndpoint } from './endpoints/upsert';
export type { UpsertResult } from './endpoints/upsert';
export { BatchCreateEndpoint } from './endpoints/batch-create';
export { BatchUpdateEndpoint } from './endpoints/batch-update';
export type { BatchUpdateItem, BatchUpdateResult } from './endpoints/batch-update';
export { BatchDeleteEndpoint } from './endpoints/batch-delete';
export type { BatchDeleteResult } from './endpoints/batch-delete';
export { BatchRestoreEndpoint } from './endpoints/batch-restore';
export type { BatchRestoreResult } from './endpoints/batch-restore';
export { BatchUpsertEndpoint } from './endpoints/batch-upsert';
export type { BatchUpsertItemResult, BatchUpsertResult } from './endpoints/batch-upsert';
export { BulkPatchEndpoint } from './endpoints/bulk-patch';
export type { BulkPatchResult } from './endpoints/bulk-patch';
export { AggregateEndpoint, computeAggregations } from './endpoints/aggregate';
export { SearchEndpoint, searchInMemory } from './endpoints/search';
export { ExportEndpoint } from './endpoints/export';
export type { ExportFormat, ExportOptions, ExportResult } from './endpoints/export';
export { ImportEndpoint } from './endpoints/import';
export type {
  ImportMode,
  ImportOptions,
  ImportResult,
  ImportRowResult,
  ImportRowStatus,
  ImportSummary,
} from './endpoints/import';

// Version-history endpoint primitives.
export {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from './endpoints/version-history';

// ============================================================================
// Orchestration helpers adapters call back into
// ============================================================================

// Cursor codecs shared by every list/pagination implementation.
export { encodeCursor, decodeCursor } from './core/cursor';

// Upsert-family soft-delete restore ("match-and-restore" contract).
export { applyUpsertRestore } from './core/soft-delete';

// Relation batch/single-item orchestrator consumed by the drizzle/prisma/memory adapters.
export {
  batchLoadRelations,
  loadRelationsForItem,
  loadRelationsForItemSync,
  resolveRelationValueAsync,
  resolveRelationValueSync,
} from './relations/batch-loader';
export type {
  RelatedRecord,
  ResolveRelation,
  FetchRelated,
  RelationLoaderAdapter,
  SyncResolveRelation,
  SyncFetchRelated,
  SyncRelationLoaderAdapter,
} from './relations/batch-loader';

// The contract adapter bundles implement, plus the generated-endpoints map.
export type { AdapterBundle, GeneratedEndpoints } from './config/index';

// ============================================================================
// Exceptions & logging
// ============================================================================

export {
  ApiException,
  ConfigurationException,
  NotFoundException,
  UnauthorizedException,
} from './core/exceptions';
export { getLogger } from './core/logger';
export type { Logger } from './core/logger';

// ============================================================================
// Context primitives
// ============================================================================

export { getContextVar, setContextVar } from './utils/context';
export { CONTEXT_KEYS } from './core/context-keys';
export type { ContextKey } from './core/context-keys';
export { getUserId } from './auth/context';
export { defaultExtractToken as extractBearerToken } from './auth/middleware/jwt';

// ============================================================================
// Primitives for first-party middleware packages (cache, rate-limit, …)
// ============================================================================

export { createStorageFeature } from './storage/feature';
export type { StorageFeature, StorageFeatureOptions } from './storage/feature';
// Companion of `createStorageFeature` — its `registry` member is a
// `StorageRegistry<T>`, so satellite-inferred types must be able to name it.
export { StorageRegistry } from './storage/registry';
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
export type { KVNamespace } from './cloudflare/index';
export { matchPath, matchAny, isPathIncluded } from './utils/path-match';
export type { PathPattern } from './utils/path-match';
export { getClientIp } from './utils/request-info';
export type { ClientIpOptions } from './utils/request-info';

// Generic TTL Map store composed by the in-memory cache/rate-limit/idempotency backends.
export { MemoryTtlStore } from './storage/memory-ttl-store';
export type { MemoryTtlStoreOptions } from './storage/memory-ttl-store';
