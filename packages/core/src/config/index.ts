/**
 * Config-Based API for defining CRUD endpoints.
 *
 * Single declarative object for all endpoints with automatic class generation.
 *
 * @example
 * ```ts
 * import { defineEndpoints } from 'hono-crud';
 * import { MemoryAdapters } from '@hono-crud/memory';
 *
 * const userEndpoints = defineEndpoints({
 *   meta: userMeta,
 *
 *   create: {
 *     openapi: { tags: ['Users'], summary: 'Create user' },
 *     hooks: { before: (data) => ({ ...data, createdAt: new Date() }) },
 *   },
 *
 *   list: {
 *     openapi: { tags: ['Users'], summary: 'List users' },
 *     filtering: { fields: ['role', 'status'] },
 *     search: { fields: ['name', 'email'] },
 *     sorting: { fields: ['createdAt'], default: 'createdAt', defaultOrder: 'desc' },
 *     pagination: { defaultPerPage: 20, maxPerPage: 100 },
 *   },
 *
 *   read: { openapi: { tags: ['Users'] } },
 *   update: { fields: { blocked: ['email'] } },
 *   delete: {},
 * }, MemoryAdapters);
 *
 * registerCrud(app, '/users', userEndpoints);
 * ```
 */

import type { Env, MiddlewareHandler } from 'hono';
import type { ZodObject, ZodRawShape } from 'zod';
import type { CacheInvalidateInput } from '../core/cache';
import { generateEndpointClass } from '../core/generate-endpoint-class';
import type { CrudEndpoints } from '../core/register';
import type { OpenAPIRoute } from '../core/route';
import type {
  AfterDeleteHook,
  AfterUpdateHook,
  AggregateResult,
  HookContext,
  HookMode,
  MetaInput,
  OpenAPIRouteSchema,
  SearchResultItem,
  SortDirection,
} from '../core/types';
import type { FilterConfig } from '../core/types';
import type { BatchUpsertResult } from '../endpoints/batch-upsert';
import type {
  AggregateExtras,
  BatchExtras,
  BatchUpsertExtras,
  BulkPatchExtras,
  CloneExtras,
  ExportExtras,
  ImportExtras,
  SearchExtras,
  UpsertExtras,
  VersionHistoryExtras,
} from '../endpoints/extras-config';
import type { ImportMode, ImportRowResult } from '../endpoints/import';
import type { ModelObject } from '../endpoints/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * OpenAPI configuration for endpoints.
 *
 * The full `OpenAPIRouteSchema` surface is accepted: `tags`, `summary` and
 * `description` for documentation, plus `responses`, `request`, `security`
 * and `operationId` overrides — user-supplied blocks are merged OVER the
 * generated schema (see `mergeRouteSchema`).
 */
type OpenAPIConfig = Partial<OpenAPIRouteSchema>;

/**
 * Hook configuration for endpoints.
 */
interface HookConfig {
  beforeMode?: HookMode;
  afterMode?: HookMode;
}

/**
 * Create endpoint hooks. The optional second argument is the engine-built
 * `HookContext` (transaction handle + tenant/actor identifiers).
 */
interface CreateHooks<M extends MetaInput> extends HookConfig {
  before?: (
    data: ModelObject<M['model']>,
    ctx?: HookContext,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (
    data: ModelObject<M['model']>,
    ctx?: HookContext,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Create endpoint configuration.
 */
export interface CreateEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: CreateHooks<M>;
  nestedCreate?: string[];
  /** Invalidate cached list/read entries after a successful create. */
  cache?: MutationCacheConfig;
  /**
   * Override the request body validation schema for this endpoint.
   *
   * When set, the default schema (model schema minus primary keys, with
   * multi-tenant exclusions and nested-relation merging applied) is bypassed
   * — the user's schema is used as-is. Same precedence as `meta.fields`, but
   * scoped to this single endpoint.
   *
   * The caller is responsible for excluding any auto-injected fields
   * (primary keys, tenant id, etc.) from the override schema.
   */
  bodySchema?: ZodObject<ZodRawShape>;
}

/**
 * List endpoint filtering configuration.
 */
interface FilteringConfig {
  fields?: string[];
  config?: FilterConfig;
}

/**
 * List endpoint search configuration.
 */
interface SearchConfig {
  fields?: string[];
  /**
   * Query parameter name carrying the inline-search string. Defaults to
   * `'search'` (maps to `ListEndpoint.searchParamName`). Note the dedicated
   * `/search` route defaults to `'q'` — a deliberate divergence.
   */
  paramName?: string;
}

/**
 * List endpoint sorting configuration.
 */
interface SortingConfig {
  /** Fields that can be used for sorting. Use with ?sort=fieldName */
  fields?: string[];
  /** Default sort field */
  default?: string;
  /** Default sort direction */
  defaultOrder?: SortDirection;
}

/**
 * List endpoint pagination configuration.
 */
interface PaginationConfig {
  defaultPerPage?: number;
  maxPerPage?: number;
  /**
   * Opt into keyset (cursor) pagination for this list endpoint. When enabled
   * and the adapter supports it, `?cursor`/`?limit` drive a forward-only
   * keyset walk ordered by `field` (default `'id'`), and responses carry a
   * `next_cursor`. Plain `?page`/`?per_page` requests stay offset-paginated.
   *
   * If the adapter does not support cursor pagination, enabling this throws a
   * `ConfigurationException` at request time (never a silent fallback).
   */
  cursor?: {
    enabled?: boolean;
    /** Keyset column — must be unique + monotonic (e.g. a ULID id). Default `'id'`. */
    field?: string;
  };
}

/**
 * List endpoint field selection configuration.
 */
interface FieldSelectionConfig {
  enabled?: boolean;
  allowed?: string[];
  blocked?: string[];
  alwaysInclude?: string[];
  defaults?: string[];
}

/**
 * List endpoint hooks.
 */
interface ListHooks<M extends MetaInput> {
  after?: (
    items: ModelObject<M['model']>[],
  ) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * Response cache configuration for list/read endpoints. Caching is opt-in;
 * `cacheStorage` is wired separately via `createCacheStorageMiddleware()`
 * (recommended on Workers) or `setCacheStorage()`.
 *
 * Cache keys are **tenant-scoped automatically** on multiTenant resources, so a
 * cached page is never served across tenants. They are NOT per-user by default:
 * if the resource uses user-scoped read **policies** (`read` / `fields` /
 * `readPushdown`), caching is automatically disabled (with a once-per-isolate
 * warning) unless you set `perUser: true` to fold the userId into the key —
 * otherwise one user's policy-shaped view could be served to another.
 */
export interface EndpointCacheConfig {
  /**
   * Enable response caching. When the `cache` block is present, this defaults
   * to `true`; set `false` to keep the block (e.g. `keyFields`) but disable.
   */
  enabled?: boolean;
  /** TTL in seconds. @default 300 */
  ttl?: number;
  /** Query params included in the cache key (default: all present query params). */
  keyFields?: string[];
  /** Add the request `userId` var to the cache key (per-user caching). */
  perUser?: boolean;
  /** Cache key prefix. */
  prefix?: string;
  /** Tags attached to cache entries (for tag-based invalidation). */
  tags?: string[];
}

/**
 * Cache invalidation configuration for mutation endpoints (create/update/delete).
 */
export interface MutationCacheConfig {
  /**
   * What to invalidate after a successful mutation:
   * - `true` → all cached entries for the model (current tenant)
   * - `Array<'list' | 'read' | 'all'>` → only those operation caches
   * - a `CacheInvalidationConfig` for tags / custom pattern / related models
   */
  invalidate?: CacheInvalidateInput;
  /** Prefix of the cache keys to invalidate (must match the read/list cache prefix). */
  prefix?: string;
}

/**
 * List endpoint configuration.
 */
export interface ListEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  filtering?: FilteringConfig;
  search?: SearchConfig;
  sorting?: SortingConfig;
  pagination?: PaginationConfig;
  includes?: string[];
  fieldSelection?: FieldSelectionConfig;
  cache?: EndpointCacheConfig;
  hooks?: ListHooks<M>;
}

/**
 * Read endpoint hooks.
 */
interface ReadHooks<M extends MetaInput> {
  after?: (
    data: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * Read endpoint configuration.
 */
export interface ReadEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  lookupField?: string;
  additionalFilters?: string[];
  includes?: string[];
  fieldSelection?: FieldSelectionConfig;
  cache?: EndpointCacheConfig;
  hooks?: ReadHooks<M>;
}

/**
 * Update endpoint field configuration.
 */
interface UpdateFieldConfig {
  allowed?: string[];
  blocked?: string[];
}

/**
 * Update endpoint hooks.
 *
 * **0.10.0 — BREAKING:** `after` now receives `(prior, current, ctx)`
 * instead of `(current, tx)`. The pre-mutation snapshot is observed
 * inside the same transaction as the parent UPDATE, so diff-based
 * audit/CDC pipelines no longer have to re-fetch in `before`.
 */
interface UpdateHooks<M extends MetaInput> extends HookConfig {
  before?: (
    data: Partial<ModelObject<M['model']>>,
    ctx?: HookContext,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  /** The exported `AfterUpdateHook` alias: `(prior, current, ctx: HookContext)`. */
  after?: AfterUpdateHook<ModelObject<M['model']>>;
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * Update endpoint configuration.
 */
export interface UpdateEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  lookupField?: string;
  additionalFilters?: string[];
  fields?: UpdateFieldConfig;
  nestedWrites?: string[];
  /** Invalidate cached list/read entries after a successful update. */
  cache?: MutationCacheConfig;
  hooks?: UpdateHooks<M>;
  /**
   * Override the request body validation schema for this endpoint.
   *
   * When set, the default schema (model schema minus primary keys, with
   * `fields.allowed` / `fields.blocked` filtering and `.partial()` applied,
   * plus nested-relation merging) is bypassed — the user's schema is used
   * as-is. Note: the override is **not** automatically wrapped in
   * `.partial()`; the caller decides which fields are required.
   */
  bodySchema?: ZodObject<ZodRawShape>;
}

/**
 * Delete endpoint hooks.
 *
 * **0.10.0 — BREAKING:** `after` now receives `(prior, ctx)` instead of
 * `(deletedItem, cascadeResult, tx)`. `prior` is the pre-mutation row,
 * observed inside the same transaction as the parent DELETE — for
 * soft-delete, the row before `deletedAt` was set. Cascade results are
 * still emitted in the response body when `includeCascadeResults: true`.
 */
interface DeleteHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValue: string, ctx?: HookContext) => Promise<void> | void;
  /** The exported `AfterDeleteHook` alias: `(prior, ctx: HookContext)`. */
  after?: AfterDeleteHook<ModelObject<M['model']>>;
}

/**
 * Delete endpoint configuration.
 */
export interface DeleteEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  lookupField?: string;
  additionalFilters?: string[];
  includeCascadeResults?: boolean;
  /** Invalidate cached list/read entries after a successful delete. */
  cache?: MutationCacheConfig;
  hooks?: DeleteHooks<M>;
}

// ----------------------------------------------------------------------------
// Extended-verb endpoint configs (search, aggregate, restore, batch.*, export,
// import, upsert, clone, bulkPatch, version*). All optional via
// EndpointsConfig<M, E>; a configured verb whose adapter bundle lacks the
// matching base class throws at definition time (see `requireAdapter`).
// ----------------------------------------------------------------------------

/**
 * Search endpoint hooks.
 *
 * The dedicated `/search` endpoint (SearchEndpoint) is read-only; `after`
 * maps to `SearchEndpoint.afterSearch` and receives the scored result items.
 */
interface SearchHooks<M extends MetaInput> {
  after?: (
    results: SearchResultItem<ModelObject<M['model']>>[],
  ) =>
    | Promise<SearchResultItem<ModelObject<M['model']>>[]>
    | SearchResultItem<ModelObject<M['model']>>[];
}

/**
 * Search endpoint configuration.
 */
export interface SearchEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  /** Fields included in the search index (maps to SearchEndpoint.searchFields). */
  fields?: string[];
  /**
   * Query parameter name carrying the search string. Defaults to `'q'`.
   * Maps to `SearchEndpoint.searchParamName`. Set e.g. `'query'` to expose
   * `/search?query=foo` instead of `/search?q=foo`.
   */
  paramName?: string;
  /** Default search mode: 'any' | 'all' | 'phrase'. Maps to SearchEndpoint.defaultMode. */
  mode?: 'any' | 'all' | 'phrase';
  hooks?: SearchHooks<M>;
}

/**
 * Aggregate endpoint hooks.
 */
interface AggregateHooks {
  after?: (result: AggregateResult) => Promise<AggregateResult> | AggregateResult;
}

/**
 * Aggregate endpoint configuration.
 */
export interface AggregateEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  /** Fields the client may filter aggregations by (maps to AggregateEndpoint.filterFields). */
  fields?: string[];
  hooks?: AggregateHooks;
}

/**
 * Restore endpoint hooks. `before` receives the lookup value; `after`
 * receives (and may replace) the restored row.
 */
interface RestoreHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValue: string) => Promise<void> | void;
  after?: (
    restoredItem: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Restore endpoint configuration.
 */
export interface RestoreEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: RestoreHooks<M>;
}

/**
 * Batch-create endpoint hooks. Both run once PER ITEM with the item's index.
 */
interface BatchCreateHooks<M extends MetaInput> extends HookConfig {
  before?: (
    item: Partial<ModelObject<M['model']>>,
    index: number,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (
    item: ModelObject<M['model']>,
    index: number,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Batch-create endpoint configuration.
 */
export interface BatchCreateEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: BatchCreateHooks<M>;
  bodySchema?: ZodObject<ZodRawShape>;
  maxBatchSize?: number;
}

/**
 * Batch-update endpoint hooks. Both run once PER ITEM: `before` receives the
 * item's lookup id plus its (field-filtered) patch data, `after` the updated
 * row.
 */
interface BatchUpdateHooks<M extends MetaInput> extends HookConfig {
  before?: (
    id: string,
    data: Partial<ModelObject<M['model']>>,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (
    item: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Batch-update endpoint configuration.
 */
export interface BatchUpdateEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: BatchUpdateHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-delete endpoint hooks. Both run once PER ITEM: `before` receives the
 * id about to be deleted, `after` the deleted row.
 */
interface BatchDeleteHooks<M extends MetaInput> extends HookConfig {
  before?: (id: string) => Promise<void> | void;
  after?: (
    item: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Batch-delete endpoint configuration.
 */
export interface BatchDeleteEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: BatchDeleteHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-restore endpoint hooks. Both run once PER ITEM: `before` receives
 * the id about to be restored, `after` the restored row.
 */
interface BatchRestoreHooks<M extends MetaInput> extends HookConfig {
  before?: (id: string) => Promise<void> | void;
  after?: (
    item: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Batch-restore endpoint configuration.
 */
export interface BatchRestoreEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: BatchRestoreHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-upsert endpoint hooks. `before` maps to
 * `BatchUpsertEndpoint.beforeBatch` (the whole validated batch); `after`
 * maps to `afterBatch` (the computed batch result).
 */
interface BatchUpsertHooks<M extends MetaInput> extends HookConfig {
  before?: (
    items: Partial<ModelObject<M['model']>>[],
  ) => Promise<Partial<ModelObject<M['model']>>[]> | Partial<ModelObject<M['model']>>[];
  after?: (
    result: BatchUpsertResult<ModelObject<M['model']>>,
  ) =>
    | Promise<BatchUpsertResult<ModelObject<M['model']>>>
    | BatchUpsertResult<ModelObject<M['model']>>;
}

/**
 * Batch-upsert endpoint configuration.
 */
export interface BatchUpsertEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: BatchUpsertHooks<M>;
  bodySchema?: ZodObject<ZodRawShape>;
  /** Conflict-target column(s) for the upsert. String is normalized to single-element array. */
  conflictTarget?: string | string[];
  maxBatchSize?: number;
}

/**
 * Export endpoint configuration.
 *
 * Note: `formats` is accepted as a whitelist hint but only the first element
 * is wired through to `defaultFormat`. Full whitelist semantics (rejecting
 * non-listed formats) require an `allowedFormats` field on ExportEndpoint —
 * deferred.
 */
export interface ExportEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  formats?: ('csv' | 'json')[];
  /** Maximum rows to export (maps to ExportEndpoint.maxExportRecords). */
  maxRows?: number;
}

/**
 * Import endpoint hooks. Both run once PER ROW: `before` receives the parsed
 * row, its 1-based row number, the import mode and the transaction handle;
 * `after` receives the per-row result, row number and mode.
 *
 * ImportEndpoint does not declare hook-mode protected fields, so
 * `beforeMode`/`afterMode` are not part of this surface.
 */
interface ImportHooks<M extends MetaInput> {
  before?: (
    row: Partial<ModelObject<M['model']>>,
    rowNumber: number,
    mode: ImportMode,
    tx?: unknown,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (
    result: ImportRowResult<ModelObject<M['model']>>,
    rowNumber: number,
    mode: ImportMode,
  ) => Promise<ImportRowResult<ModelObject<M['model']>>> | ImportRowResult<ModelObject<M['model']>>;
}

/**
 * Import endpoint configuration.
 */
export interface ImportEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: ImportHooks<M>;
  /** Maximum rows accepted per request (maps to ImportEndpoint.maxBatchSize). */
  maxRows?: number;
}

/**
 * Upsert endpoint hooks. The boolean second argument reports whether the
 * operation is (`before`) / was (`after`) a create rather than an update.
 */
interface UpsertHooks<M extends MetaInput> extends HookConfig {
  before?: (
    data: Partial<ModelObject<M['model']>>,
    isCreate: boolean,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (
    data: ModelObject<M['model']>,
    created: boolean,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Upsert endpoint configuration.
 */
export interface UpsertEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: UpsertHooks<M>;
  bodySchema?: ZodObject<ZodRawShape>;
  /** Conflict-target column(s) for the upsert. String is normalized to single-element array. */
  conflictTarget?: string | string[];
}

/**
 * Clone endpoint hooks. `before` receives (and may replace) the prepared
 * clone payload — the source row minus primary keys and excluded fields,
 * with body overrides applied; `after` receives the inserted clone.
 */
interface CloneHooks<M extends MetaInput> {
  before?: (
    data: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (
    cloned: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Clone endpoint configuration.
 */
export interface CloneEndpointConfig<M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  hooks?: CloneHooks<M>;
  /** Field names to strip from the cloned record (maps to CloneEndpoint.excludeFromClone). */
  fieldsToReset?: string[];
}

/**
 * Bulk-patch endpoint configuration (`PATCH /resource/bulk` — patch every
 * record matching a filter).
 */
export interface BulkPatchEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  /** Fields the client may filter the target set by (maps to BulkPatchEndpoint.filterFields). */
  fields?: string[];
  /** Maximum records patchable per request (maps to maxBulkSize, default 1000). */
  maxBulkSize?: number;
  /** Matched-count threshold requiring the `X-Confirm-Bulk: true` header (maps to confirmThreshold, default 100). */
  confirmThreshold?: number;
  /** Include the patched records in the response (maps to returnRecords, default false). */
  returnRecords?: boolean;
}

/**
 * Version-history endpoint configuration (`GET /:id/versions`).
 * Requires `meta.model.versioning` to be configured.
 */
export interface VersionHistoryEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
  /** Default page size for the version list (maps to defaultLimit, default 20). */
  defaultLimit?: number;
  /** Maximum page size for the version list (maps to maxLimit, default 100). */
  maxLimit?: number;
}

/**
 * Single-version read endpoint configuration (`GET /:id/versions/:version`).
 * Requires `meta.model.versioning` to be configured.
 */
export interface VersionReadEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Version-compare endpoint configuration (`GET /:id/versions/compare`).
 * Requires `meta.model.versioning` to be configured.
 */
export interface VersionCompareEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Version-rollback endpoint configuration (`POST /:id/versions/:version/rollback`).
 * Requires `meta.model.versioning` to be configured.
 */
export interface VersionRollbackEndpointConfig<_M extends MetaInput, E extends Env = Env> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Complete endpoints configuration object — one optional slot per
 * `registerCrud` verb (all 22), plus the shared `meta`.
 */
export interface EndpointsConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** Create endpoint configuration */
  create?: CreateEndpointConfig<M, E>;
  /** List endpoint configuration */
  list?: ListEndpointConfig<M, E>;
  /** Read endpoint configuration */
  read?: ReadEndpointConfig<M, E>;
  /** Update endpoint configuration */
  update?: UpdateEndpointConfig<M, E>;
  /** Delete endpoint configuration */
  delete?: DeleteEndpointConfig<M, E>;
  /** Search endpoint configuration */
  search?: SearchEndpointConfig<M, E>;
  /** Aggregate endpoint configuration */
  aggregate?: AggregateEndpointConfig<M, E>;
  /** Restore endpoint configuration (un-delete soft-deleted records) */
  restore?: RestoreEndpointConfig<M, E>;
  /** Batch-create endpoint configuration */
  batchCreate?: BatchCreateEndpointConfig<M, E>;
  /** Batch-update endpoint configuration */
  batchUpdate?: BatchUpdateEndpointConfig<M, E>;
  /** Batch-delete endpoint configuration */
  batchDelete?: BatchDeleteEndpointConfig<M, E>;
  /** Batch-restore endpoint configuration */
  batchRestore?: BatchRestoreEndpointConfig<M, E>;
  /** Batch-upsert endpoint configuration */
  batchUpsert?: BatchUpsertEndpointConfig<M, E>;
  /** Export endpoint configuration */
  export?: ExportEndpointConfig<M, E>;
  /** Import endpoint configuration */
  import?: ImportEndpointConfig<M, E>;
  /** Upsert endpoint configuration */
  upsert?: UpsertEndpointConfig<M, E>;
  /** Clone endpoint configuration */
  clone?: CloneEndpointConfig<M, E>;
  /** Bulk-patch endpoint configuration (PATCH a filtered set at the collection level) */
  bulkPatch?: BulkPatchEndpointConfig<M, E>;
  /** Version-history list endpoint configuration (`GET /:id/versions`) */
  versionHistory?: VersionHistoryEndpointConfig<M, E>;
  /** Single-version read endpoint configuration (`GET /:id/versions/:version`) */
  versionRead?: VersionReadEndpointConfig<M, E>;
  /** Version-compare endpoint configuration (`GET /:id/versions/compare`) */
  versionCompare?: VersionCompareEndpointConfig<M, E>;
  /** Version-rollback endpoint configuration (`POST /:id/versions/:version/rollback`) */
  versionRollback?: VersionRollbackEndpointConfig<M, E>;
}

/**
 * Adapter bundle containing base classes for all CRUD operations.
 */
export interface AdapterBundle<E extends Env = Env> {
  CreateEndpoint: abstract new () => OpenAPIRoute<E>;
  ListEndpoint: abstract new () => OpenAPIRoute<E>;
  ReadEndpoint: abstract new () => OpenAPIRoute<E>;
  UpdateEndpoint: abstract new () => OpenAPIRoute<E>;
  DeleteEndpoint: abstract new () => OpenAPIRoute<E>;
  // Optional extended-verb slots — adapters populate what they implement.
  // Slot presence IS the capability signal: configuring a verb whose slot is
  // absent makes `defineEndpoints` throw at definition time (loud failure
  // instead of a silently missing route).
  SearchEndpoint?: abstract new () => OpenAPIRoute<E>;
  AggregateEndpoint?: abstract new () => OpenAPIRoute<E>;
  RestoreEndpoint?: abstract new () => OpenAPIRoute<E>;
  BatchCreateEndpoint?: abstract new () => OpenAPIRoute<E>;
  BatchUpdateEndpoint?: abstract new () => OpenAPIRoute<E>;
  BatchDeleteEndpoint?: abstract new () => OpenAPIRoute<E>;
  BatchRestoreEndpoint?: abstract new () => OpenAPIRoute<E>;
  BatchUpsertEndpoint?: abstract new () => OpenAPIRoute<E>;
  ExportEndpoint?: abstract new () => OpenAPIRoute<E>;
  ImportEndpoint?: abstract new () => OpenAPIRoute<E>;
  UpsertEndpoint?: abstract new () => OpenAPIRoute<E>;
  CloneEndpoint?: abstract new () => OpenAPIRoute<E>;
  BulkPatchEndpoint?: abstract new () => OpenAPIRoute<E>;
  VersionHistoryEndpoint?: abstract new () => OpenAPIRoute<E>;
  VersionReadEndpoint?: abstract new () => OpenAPIRoute<E>;
  VersionCompareEndpoint?: abstract new () => OpenAPIRoute<E>;
  VersionRollbackEndpoint?: abstract new () => OpenAPIRoute<E>;
}

/**
 * Generated endpoints object compatible with registerCrud.
 *
 * Derived as a `Pick` over `CrudEndpoints` keyed by the config slots, so it
 * is structurally guaranteed to stay a subset of what `registerCrud` accepts
 * — the two can never drift again.
 */
export type GeneratedEndpoints<E extends Env = Env> = Pick<
  CrudEndpoints<E>,
  Exclude<keyof EndpointsConfig<MetaInput>, 'meta'>
>;

// ============================================================================
// Adapter slot lookup
// ============================================================================

/**
 * Extended verb → adapter-bundle slot lookup map. The 5 basic verbs are
 * required on every bundle and need no gate.
 */
const EXTENDED_VERB_SLOTS = {
  search: 'SearchEndpoint',
  aggregate: 'AggregateEndpoint',
  restore: 'RestoreEndpoint',
  batchCreate: 'BatchCreateEndpoint',
  batchUpdate: 'BatchUpdateEndpoint',
  batchDelete: 'BatchDeleteEndpoint',
  batchRestore: 'BatchRestoreEndpoint',
  batchUpsert: 'BatchUpsertEndpoint',
  export: 'ExportEndpoint',
  import: 'ImportEndpoint',
  upsert: 'UpsertEndpoint',
  clone: 'CloneEndpoint',
  bulkPatch: 'BulkPatchEndpoint',
  versionHistory: 'VersionHistoryEndpoint',
  versionRead: 'VersionReadEndpoint',
  versionCompare: 'VersionCompareEndpoint',
  versionRollback: 'VersionRollbackEndpoint',
} as const satisfies Record<string, keyof AdapterBundle>;

type ExtendedVerb = keyof typeof EXTENDED_VERB_SLOTS;

/**
 * Resolves the adapter base class for a configured extended verb, throwing a
 * plain setup-time `Error` (fail-fast at boot, per the error-split doctrine)
 * when the bundle does not ship the matching class. Explicit configuration
 * deserves explicit failure — the previous behavior silently skipped the
 * verb, surfacing only as production 404s.
 */
function requireAdapter<E extends Env>(
  adapters: AdapterBundle<E>,
  verb: ExtendedVerb,
): abstract new () => OpenAPIRoute<E> {
  const slot = EXTENDED_VERB_SLOTS[verb];
  const BaseClass = adapters[slot];
  if (!BaseClass) {
    throw new Error(
      `defineEndpoints: "${verb}" is configured but the adapter bundle has no ${slot}. ` +
        `Use an adapter bundle that ships ${slot}, or remove the "${verb}" config.`,
    );
  }
  return BaseClass;
}

// ============================================================================
// defineEndpoints Function
// ============================================================================

type AnyHook = ((...args: unknown[]) => unknown) | undefined;

/**
 * Creates endpoint classes from a declarative configuration object.
 *
 * @param config - Configuration object for all endpoints
 * @param adapters - Adapter bundle containing base classes
 * @returns Object with generated endpoint classes compatible with registerCrud
 *
 * @example
 * ```ts
 * const userEndpoints = defineEndpoints({
 *   meta: userMeta,
 *
 *   create: {
 *     openapi: { tags: ['Users'], summary: 'Create user' },
 *     hooks: { before: (data) => ({ ...data, createdAt: new Date() }) },
 *   },
 *
 *   list: {
 *     openapi: { tags: ['Users'], summary: 'List users' },
 *     filtering: { fields: ['role', 'status'] },
 *     search: { fields: ['name', 'email'] },
 *     sorting: { fields: ['createdAt'], default: 'createdAt', defaultOrder: 'desc' },
 *     pagination: { defaultPerPage: 20, maxPerPage: 100 },
 *   },
 *
 *   read: { openapi: { tags: ['Users'] } },
 *   update: { fields: { blocked: ['email'] } },
 *   delete: {},
 * }, MemoryAdapters);
 *
 * registerCrud(app, '/users', userEndpoints);
 * ```
 */
export function defineEndpoints<M extends MetaInput, E extends Env = Env>(
  config: EndpointsConfig<M, E>,
  adapters: AdapterBundle<E>,
): GeneratedEndpoints<E> {
  const result: GeneratedEndpoints<E> = {};

  // Generate Create endpoint
  if (config.create !== undefined) {
    const cfg = config.create;
    result.create = generateEndpointClass(adapters.CreateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      allowNestedCreate: cfg.nestedCreate,
      cacheInvalidate: cfg.cache?.invalidate,
      cachePrefix: cfg.cache?.prefix,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
    });
  }

  // Generate List endpoint
  if (config.list !== undefined) {
    const cfg = config.list;
    result.list = generateEndpointClass(adapters.ListEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      filterFields: cfg.filtering?.fields,
      filterConfig: cfg.filtering?.config,
      searchFields: cfg.search?.fields,
      searchParamName: cfg.search?.paramName,
      sortFields: cfg.sorting?.fields,
      defaultSort: cfg.sorting?.default
        ? {
            field: cfg.sorting.default,
            order: cfg.sorting.defaultOrder ?? 'asc',
          }
        : undefined,
      defaultPerPage: cfg.pagination?.defaultPerPage,
      maxPerPage: cfg.pagination?.maxPerPage,
      cursorPaginationEnabled: cfg.pagination?.cursor?.enabled,
      cursorField: cfg.pagination?.cursor?.field,
      allowedIncludes: cfg.includes,
      fieldSelectionEnabled: cfg.fieldSelection?.enabled,
      allowedSelectFields: cfg.fieldSelection?.allowed,
      blockedSelectFields: cfg.fieldSelection?.blocked,
      alwaysIncludeFields: cfg.fieldSelection?.alwaysInclude,
      defaultSelectFields: cfg.fieldSelection?.defaults,
      // Presence of the `cache` block enables caching unless `enabled: false`.
      cacheEnabled: cfg.cache ? (cfg.cache.enabled ?? true) : undefined,
      cacheTtlSeconds: cfg.cache?.ttl,
      cacheKeyFields: cfg.cache?.keyFields,
      cachePerUser: cfg.cache?.perUser,
      cachePrefix: cfg.cache?.prefix,
      cacheTags: cfg.cache?.tags,
      after: cfg.hooks?.after as AnyHook,
      transform: cfg.hooks?.transform as AnyHook,
    });
  }

  // Generate Read endpoint
  if (config.read !== undefined) {
    const cfg = config.read;
    result.read = generateEndpointClass(adapters.ReadEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      allowedIncludes: cfg.includes,
      fieldSelectionEnabled: cfg.fieldSelection?.enabled,
      allowedSelectFields: cfg.fieldSelection?.allowed,
      blockedSelectFields: cfg.fieldSelection?.blocked,
      alwaysIncludeFields: cfg.fieldSelection?.alwaysInclude,
      defaultSelectFields: cfg.fieldSelection?.defaults,
      cacheEnabled: cfg.cache ? (cfg.cache.enabled ?? true) : undefined,
      cacheTtlSeconds: cfg.cache?.ttl,
      cacheKeyFields: cfg.cache?.keyFields,
      cachePerUser: cfg.cache?.perUser,
      cachePrefix: cfg.cache?.prefix,
      cacheTags: cfg.cache?.tags,
      after: cfg.hooks?.after as AnyHook,
      transform: cfg.hooks?.transform as AnyHook,
    });
  }

  // Generate Update endpoint
  if (config.update !== undefined) {
    const cfg = config.update;
    result.update = generateEndpointClass(adapters.UpdateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      bodySchema: cfg.bodySchema,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      allowedUpdateFields: cfg.fields?.allowed,
      blockedUpdateFields: cfg.fields?.blocked,
      allowNestedWrites: cfg.nestedWrites,
      cacheInvalidate: cfg.cache?.invalidate,
      cachePrefix: cfg.cache?.prefix,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      transform: cfg.hooks?.transform as AnyHook,
    });
  }

  // Generate Delete endpoint
  if (config.delete !== undefined) {
    const cfg = config.delete;
    result.delete = generateEndpointClass(adapters.DeleteEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      includeCascadeResults: cfg.includeCascadeResults,
      cacheInvalidate: cfg.cache?.invalidate,
      cachePrefix: cfg.cache?.prefix,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
    });
  }

  // ----- Extended-verb dispatch arms -----
  // Each arm fires when the config slot is present; a missing adapter slot is
  // a loud setup-time error (see `requireAdapter`), never a silent skip.

  // Generate Search endpoint
  if (config.search !== undefined) {
    const cfg = config.search;
    const extras: SearchExtras = {};
    if (cfg.fields !== undefined) extras.searchFields = cfg.fields;
    if (cfg.mode !== undefined) extras.defaultMode = cfg.mode;
    if (cfg.paramName !== undefined) extras.searchParamName = cfg.paramName;
    // SearchEndpoint's lifecycle hook is `afterSearch` (not `after`), so the
    // hook is wired through extras — the previous `after` pass-through never
    // fired.
    if (cfg.hooks?.after !== undefined) extras.afterSearch = cfg.hooks.after;
    result.search = generateEndpointClass(requireAdapter(adapters, 'search'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      extras,
    });
  }

  // Generate Aggregate endpoint
  if (config.aggregate !== undefined) {
    const cfg = config.aggregate;
    const extras: AggregateExtras = {};
    if (cfg.fields !== undefined) extras.filterFields = cfg.fields;
    result.aggregate = generateEndpointClass(requireAdapter(adapters, 'aggregate'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate Restore endpoint
  if (config.restore !== undefined) {
    const cfg = config.restore;
    result.restore = generateEndpointClass(requireAdapter(adapters, 'restore'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
    });
  }

  // Generate BatchCreate endpoint
  if (config.batchCreate !== undefined) {
    const cfg = config.batchCreate;
    const extras: BatchExtras = {};
    if (cfg.maxBatchSize !== undefined) extras.maxBatchSize = cfg.maxBatchSize;
    result.batchCreate = generateEndpointClass(requireAdapter(adapters, 'batchCreate'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate BatchUpdate endpoint
  if (config.batchUpdate !== undefined) {
    const cfg = config.batchUpdate;
    const extras: BatchExtras = {};
    if (cfg.maxBatchSize !== undefined) extras.maxBatchSize = cfg.maxBatchSize;
    result.batchUpdate = generateEndpointClass(requireAdapter(adapters, 'batchUpdate'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate BatchDelete endpoint
  if (config.batchDelete !== undefined) {
    const cfg = config.batchDelete;
    const extras: BatchExtras = {};
    if (cfg.maxBatchSize !== undefined) extras.maxBatchSize = cfg.maxBatchSize;
    result.batchDelete = generateEndpointClass(requireAdapter(adapters, 'batchDelete'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate BatchRestore endpoint
  if (config.batchRestore !== undefined) {
    const cfg = config.batchRestore;
    const extras: BatchExtras = {};
    if (cfg.maxBatchSize !== undefined) extras.maxBatchSize = cfg.maxBatchSize;
    result.batchRestore = generateEndpointClass(requireAdapter(adapters, 'batchRestore'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate BatchUpsert endpoint
  if (config.batchUpsert !== undefined) {
    const cfg = config.batchUpsert;
    const upsertKeys =
      typeof cfg.conflictTarget === 'string' ? [cfg.conflictTarget] : cfg.conflictTarget;
    const extras: BatchUpsertExtras = {};
    if (cfg.maxBatchSize !== undefined) extras.maxBatchSize = cfg.maxBatchSize;
    if (upsertKeys !== undefined) extras.upsertKeys = upsertKeys;
    // BatchUpsertEndpoint's lifecycle hooks are `beforeBatch`/`afterBatch`
    // (not `before`/`after`), so the hooks are wired through extras — the
    // previous `before`/`after` pass-through never fired.
    if (cfg.hooks?.before !== undefined) extras.beforeBatch = cfg.hooks.before;
    if (cfg.hooks?.after !== undefined) extras.afterBatch = cfg.hooks.after;
    result.batchUpsert = generateEndpointClass(requireAdapter(adapters, 'batchUpsert'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      extras,
    });
  }

  // Generate Export endpoint
  if (config.export !== undefined) {
    const cfg = config.export;
    const extras: ExportExtras = {};
    if (cfg.maxRows !== undefined) extras.maxExportRecords = cfg.maxRows;
    if (cfg.formats !== undefined && cfg.formats.length > 0) extras.defaultFormat = cfg.formats[0];
    result.export = generateEndpointClass(requireAdapter(adapters, 'export'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      extras,
    });
  }

  // Generate Import endpoint
  if (config.import !== undefined) {
    const cfg = config.import;
    const extras: ImportExtras = {};
    if (cfg.maxRows !== undefined) extras.maxBatchSize = cfg.maxRows;
    result.import = generateEndpointClass(requireAdapter(adapters, 'import'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate Upsert endpoint
  if (config.upsert !== undefined) {
    const cfg = config.upsert;
    const upsertKeys =
      typeof cfg.conflictTarget === 'string' ? [cfg.conflictTarget] : cfg.conflictTarget;
    const extras: UpsertExtras = {};
    if (upsertKeys !== undefined) extras.upsertKeys = upsertKeys;
    result.upsert = generateEndpointClass(requireAdapter(adapters, 'upsert'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate Clone endpoint
  if (config.clone !== undefined) {
    const cfg = config.clone;
    const extras: CloneExtras = {};
    if (cfg.fieldsToReset !== undefined) extras.excludeFromClone = cfg.fieldsToReset;
    result.clone = generateEndpointClass(requireAdapter(adapters, 'clone'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      before: cfg.hooks?.before as AnyHook,
      after: cfg.hooks?.after as AnyHook,
      extras,
    });
  }

  // Generate BulkPatch endpoint
  if (config.bulkPatch !== undefined) {
    const cfg = config.bulkPatch;
    const extras: BulkPatchExtras = {};
    if (cfg.fields !== undefined) extras.filterFields = cfg.fields;
    if (cfg.maxBulkSize !== undefined) extras.maxBulkSize = cfg.maxBulkSize;
    if (cfg.confirmThreshold !== undefined) extras.confirmThreshold = cfg.confirmThreshold;
    if (cfg.returnRecords !== undefined) extras.returnRecords = cfg.returnRecords;
    result.bulkPatch = generateEndpointClass(requireAdapter(adapters, 'bulkPatch'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      extras,
    });
  }

  // Generate VersionHistory endpoint
  if (config.versionHistory !== undefined) {
    const cfg = config.versionHistory;
    const extras: VersionHistoryExtras = {};
    if (cfg.defaultLimit !== undefined) extras.defaultLimit = cfg.defaultLimit;
    if (cfg.maxLimit !== undefined) extras.maxLimit = cfg.maxLimit;
    result.versionHistory = generateEndpointClass(requireAdapter(adapters, 'versionHistory'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
      extras,
    });
  }

  // Generate VersionRead endpoint
  if (config.versionRead !== undefined) {
    const cfg = config.versionRead;
    result.versionRead = generateEndpointClass(requireAdapter(adapters, 'versionRead'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
    });
  }

  // Generate VersionCompare endpoint
  if (config.versionCompare !== undefined) {
    const cfg = config.versionCompare;
    result.versionCompare = generateEndpointClass(requireAdapter(adapters, 'versionCompare'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
    });
  }

  // Generate VersionRollback endpoint
  if (config.versionRollback !== undefined) {
    const cfg = config.versionRollback;
    result.versionRollback = generateEndpointClass(requireAdapter(adapters, 'versionRollback'), {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares as MiddlewareHandler[] | undefined,
    });
  }

  return result;
}
