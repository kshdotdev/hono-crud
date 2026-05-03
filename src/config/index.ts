/**
 * Config-Based API for defining CRUD endpoints.
 *
 * Single declarative object for all endpoints with automatic class generation.
 *
 * @example
 * ```ts
 * import { defineEndpoints, MemoryAdapters } from 'hono-crud';
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
import type { MetaInput, HookMode } from '../core/types';
import type { FilterConfig } from '../core/types';
import type { OpenAPIRoute } from '../core/route';
import type { EndpointClass } from '../utils';
import type { ModelObject } from '../endpoints/types';
import { generateEndpointClass } from '../core/generate-endpoint-class';


// Import memory adapters for the MemoryAdapters bundle
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryRestoreEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpsertEndpoint,
  MemorySearchEndpoint,
  MemoryAggregateEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemoryUpsertEndpoint,
  MemoryCloneEndpoint,
} from '../adapters/memory/index';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * OpenAPI configuration for endpoints.
 */
interface OpenAPIConfig {
  tags?: string[];
  summary?: string;
  description?: string;
}

/**
 * Hook configuration for endpoints.
 */
interface HookConfig {
  beforeMode?: HookMode;
  afterMode?: HookMode;
}

/**
 * Create endpoint hooks.
 */
interface CreateHooks<M extends MetaInput> extends HookConfig {
  before?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Create endpoint configuration.
 */
export interface CreateEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: CreateHooks<M>;
  nestedCreate?: string[];
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
  defaultOrder?: 'asc' | 'desc';
  /** Backward-compatible alias for defaultOrder */
  defaultDirection?: 'asc' | 'desc';
}

/**
 * List endpoint pagination configuration.
 */
interface PaginationConfig {
  defaultPerPage?: number;
  maxPerPage?: number;
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
  after?: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * List endpoint configuration.
 */
export interface ListEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  filtering?: FilteringConfig;
  search?: SearchConfig;
  sorting?: SortingConfig;
  pagination?: PaginationConfig;
  includes?: string[];
  fieldSelection?: FieldSelectionConfig;
  hooks?: ListHooks<M>;
}

/**
 * Read endpoint hooks.
 */
interface ReadHooks<M extends MetaInput> {
  after?: (data: ModelObject<M['model']>) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * Read endpoint configuration.
 */
export interface ReadEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  lookupField?: string;
  additionalFilters?: string[];
  includes?: string[];
  fieldSelection?: FieldSelectionConfig;
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
 */
interface UpdateHooks<M extends MetaInput> extends HookConfig {
  before?: (data: Partial<ModelObject<M['model']>>, tx?: unknown) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  transform?: (item: ModelObject<M['model']>) => unknown;
}

/**
 * Update endpoint configuration.
 */
export interface UpdateEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  lookupField?: string;
  additionalFilters?: string[];
  fields?: UpdateFieldConfig;
  nestedWrites?: string[];
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
 */
interface DeleteHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValue: string, tx?: unknown) => Promise<void> | void;
  after?: (deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown) => Promise<void> | void;
}

/**
 * Delete endpoint configuration.
 */
export interface DeleteEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  lookupField?: string;
  additionalFilters?: string[];
  includeCascadeResults?: boolean;
  hooks?: DeleteHooks<M>;
}

// ----------------------------------------------------------------------------
// Extended-verb endpoint configs (search, aggregate, restore, batch.*, export,
// import, upsert, clone). All optional via EndpointsConfig<M>; the dispatch
// arms below only fire when the slot is present.
// ----------------------------------------------------------------------------

/**
 * Search endpoint hooks.
 *
 * The dedicated `/search` endpoint (SearchEndpoint) is read-only and only
 * supports an `after` callback for post-processing results.
 */
interface SearchHooks<M extends MetaInput> {
  after?: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
}

/**
 * Search endpoint configuration.
 *
 * Note: `paramName` is reserved in the briefed shape but not currently wired —
 * the SearchEndpoint reads its query from a fixed `q` param. Override via a
 * subclass for now; first-class config will follow if there's demand.
 */
export interface SearchEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  /** Fields included in the search index (maps to SearchEndpoint.searchFields). */
  fields?: string[];
  /** Reserved — currently unused; SearchEndpoint reads `q` by default. */
  paramName?: string;
  /** Default search mode: 'any' | 'all' | 'phrase'. Maps to SearchEndpoint.defaultMode. */
  mode?: 'any' | 'all' | 'phrase';
  hooks?: SearchHooks<M>;
}

/**
 * Aggregate endpoint hooks.
 */
interface AggregateHooks {
  after?: (result: unknown) => Promise<unknown> | unknown;
}

/**
 * Aggregate endpoint configuration.
 */
export interface AggregateEndpointConfig<_M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  /** Fields the client may filter aggregations by (maps to AggregateEndpoint.filterFields). */
  fields?: string[];
  hooks?: AggregateHooks;
}

/**
 * Restore endpoint hooks.
 */
interface RestoreHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValue: string, tx?: unknown) => Promise<void> | void;
  after?: (restoredItem: ModelObject<M['model']>, tx?: unknown) => Promise<void> | void;
}

/**
 * Restore endpoint configuration.
 */
export interface RestoreEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: RestoreHooks<M>;
}

/**
 * Batch-create endpoint hooks.
 */
interface BatchCreateHooks<M extends MetaInput> extends HookConfig {
  before?: (data: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  after?: (data: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
}

/**
 * Batch-create endpoint configuration.
 */
export interface BatchCreateEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: BatchCreateHooks<M>;
  bodySchema?: ZodObject<ZodRawShape>;
  maxBatchSize?: number;
}

/**
 * Batch-update endpoint hooks.
 */
interface BatchUpdateHooks<M extends MetaInput> extends HookConfig {
  before?: (data: Partial<ModelObject<M['model']>>[], tx?: unknown) => Promise<Partial<ModelObject<M['model']>>[]> | Partial<ModelObject<M['model']>>[];
  after?: (data: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
}

/**
 * Batch-update endpoint configuration.
 */
export interface BatchUpdateEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: BatchUpdateHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-delete endpoint hooks.
 */
interface BatchDeleteHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValues: string[], tx?: unknown) => Promise<void> | void;
  after?: (deletedItems: ModelObject<M['model']>[], tx?: unknown) => Promise<void> | void;
}

/**
 * Batch-delete endpoint configuration.
 */
export interface BatchDeleteEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: BatchDeleteHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-restore endpoint hooks.
 */
interface BatchRestoreHooks<M extends MetaInput> extends HookConfig {
  before?: (lookupValues: string[], tx?: unknown) => Promise<void> | void;
  after?: (restoredItems: ModelObject<M['model']>[], tx?: unknown) => Promise<void> | void;
}

/**
 * Batch-restore endpoint configuration.
 */
export interface BatchRestoreEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: BatchRestoreHooks<M>;
  maxBatchSize?: number;
}

/**
 * Batch-upsert endpoint hooks.
 */
interface BatchUpsertHooks<M extends MetaInput> extends HookConfig {
  before?: (data: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  after?: (data: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
}

/**
 * Batch-upsert endpoint configuration.
 */
export interface BatchUpsertEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
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
export interface ExportEndpointConfig<_M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  formats?: ('csv' | 'json')[];
  /** Maximum rows to export (maps to ExportEndpoint.maxExportRecords). */
  maxRows?: number;
}

/**
 * Import endpoint hooks.
 *
 * Hook callbacks delegate via `super.before/after`; ImportEndpoint does not
 * declare hook-mode protected fields, so `beforeMode`/`afterMode` are not part
 * of this surface.
 */
interface ImportHooks<M extends MetaInput> {
  before?: (rows: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  after?: (rows: ModelObject<M['model']>[], tx?: unknown) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
}

/**
 * Import endpoint configuration.
 */
export interface ImportEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: ImportHooks<M>;
  /** Maximum rows accepted per request (maps to ImportEndpoint.maxBatchSize). */
  maxRows?: number;
}

/**
 * Upsert endpoint hooks.
 */
interface UpsertHooks<M extends MetaInput> extends HookConfig {
  before?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
}

/**
 * Upsert endpoint configuration.
 */
export interface UpsertEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: UpsertHooks<M>;
  bodySchema?: ZodObject<ZodRawShape>;
  /** Conflict-target column(s) for the upsert. String is normalized to single-element array. */
  conflictTarget?: string | string[];
}

/**
 * Clone endpoint hooks.
 */
interface CloneHooks<M extends MetaInput> {
  before?: (sourceId: string, tx?: unknown) => Promise<void> | void;
  after?: (cloned: ModelObject<M['model']>, tx?: unknown) => Promise<void> | void;
}

/**
 * Clone endpoint configuration.
 */
export interface CloneEndpointConfig<M extends MetaInput> {
  openapi?: OpenAPIConfig;
  /** Middleware applied to this endpoint route. Runs before the handler. */
  middlewares?: MiddlewareHandler[];
  hooks?: CloneHooks<M>;
  /** Field names to strip from the cloned record (maps to CloneEndpoint.excludeFromClone). */
  fieldsToReset?: string[];
}

/**
 * Complete endpoints configuration object.
 */
export interface EndpointsConfig<M extends MetaInput> {
  /** Meta configuration for the model */
  meta: M;
  /** Create endpoint configuration */
  create?: CreateEndpointConfig<M>;
  /** List endpoint configuration */
  list?: ListEndpointConfig<M>;
  /** Read endpoint configuration */
  read?: ReadEndpointConfig<M>;
  /** Update endpoint configuration */
  update?: UpdateEndpointConfig<M>;
  /** Delete endpoint configuration */
  delete?: DeleteEndpointConfig<M>;
  /** Search endpoint configuration */
  search?: SearchEndpointConfig<M>;
  /** Aggregate endpoint configuration */
  aggregate?: AggregateEndpointConfig<M>;
  /** Restore endpoint configuration (un-delete soft-deleted records) */
  restore?: RestoreEndpointConfig<M>;
  /** Batch-create endpoint configuration */
  batchCreate?: BatchCreateEndpointConfig<M>;
  /** Batch-update endpoint configuration */
  batchUpdate?: BatchUpdateEndpointConfig<M>;
  /** Batch-delete endpoint configuration */
  batchDelete?: BatchDeleteEndpointConfig<M>;
  /** Batch-restore endpoint configuration */
  batchRestore?: BatchRestoreEndpointConfig<M>;
  /** Batch-upsert endpoint configuration */
  batchUpsert?: BatchUpsertEndpointConfig<M>;
  /** Export endpoint configuration */
  export?: ExportEndpointConfig<M>;
  /** Import endpoint configuration */
  import?: ImportEndpointConfig<M>;
  /** Upsert endpoint configuration */
  upsert?: UpsertEndpointConfig<M>;
  /** Clone endpoint configuration */
  clone?: CloneEndpointConfig<M>;
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
  // Optional extended-verb slots — adapters populate what they implement;
  // dispatch arms gate on both `config.<verb>` and adapter presence.
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
}

/**
 * Generated endpoints object compatible with registerCrud.
 */
export interface GeneratedEndpoints<E extends Env = Env> {
  create?: EndpointClass<E>;
  list?: EndpointClass<E>;
  read?: EndpointClass<E>;
  update?: EndpointClass<E>;
  delete?: EndpointClass<E>;
  search?: EndpointClass<E>;
  aggregate?: EndpointClass<E>;
  restore?: EndpointClass<E>;
  batchCreate?: EndpointClass<E>;
  batchUpdate?: EndpointClass<E>;
  batchDelete?: EndpointClass<E>;
  batchRestore?: EndpointClass<E>;
  batchUpsert?: EndpointClass<E>;
  export?: EndpointClass<E>;
  import?: EndpointClass<E>;
  upsert?: EndpointClass<E>;
  clone?: EndpointClass<E>;
}

// ============================================================================
// Memory Adapters Bundle
// ============================================================================

/**
 * Memory adapter bundle for use with defineEndpoints.
 *
 * @example
 * ```ts
 * const userEndpoints = defineEndpoints({ meta: userMeta, ... }, MemoryAdapters);
 * ```
 */
export const MemoryAdapters: AdapterBundle = {
  CreateEndpoint: MemoryCreateEndpoint,
  ListEndpoint: MemoryListEndpoint,
  ReadEndpoint: MemoryReadEndpoint,
  UpdateEndpoint: MemoryUpdateEndpoint,
  DeleteEndpoint: MemoryDeleteEndpoint,
  SearchEndpoint: MemorySearchEndpoint,
  AggregateEndpoint: MemoryAggregateEndpoint,
  RestoreEndpoint: MemoryRestoreEndpoint,
  BatchCreateEndpoint: MemoryBatchCreateEndpoint,
  BatchUpdateEndpoint: MemoryBatchUpdateEndpoint,
  BatchDeleteEndpoint: MemoryBatchDeleteEndpoint,
  BatchRestoreEndpoint: MemoryBatchRestoreEndpoint,
  BatchUpsertEndpoint: MemoryBatchUpsertEndpoint,
  ExportEndpoint: MemoryExportEndpoint,
  ImportEndpoint: MemoryImportEndpoint,
  UpsertEndpoint: MemoryUpsertEndpoint,
  CloneEndpoint: MemoryCloneEndpoint,
};

// ============================================================================
// defineEndpoints Function
// ============================================================================

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
  config: EndpointsConfig<M>,
  adapters: AdapterBundle<E>
): GeneratedEndpoints<E> {
  const result: GeneratedEndpoints<E> = {};

  // Generate Create endpoint
  if (config.create !== undefined) {
    const cfg = config.create;
    result.create = generateEndpointClass(adapters.CreateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      allowNestedCreate: cfg.nestedCreate,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // Generate List endpoint
  if (config.list !== undefined) {
    const cfg = config.list;
    result.list = generateEndpointClass(adapters.ListEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      filterFields: cfg.filtering?.fields,
      filterConfig: cfg.filtering?.config,
      searchFields: cfg.search?.fields,
      searchFieldName: cfg.search?.paramName,
      sortFields: cfg.sorting?.fields,
      defaultSort: cfg.sorting?.default
        ? { field: cfg.sorting.default, order: cfg.sorting.defaultOrder ?? cfg.sorting.defaultDirection ?? 'asc' }
        : undefined,
      defaultPerPage: cfg.pagination?.defaultPerPage,
      maxPerPage: cfg.pagination?.maxPerPage,
      allowedIncludes: cfg.includes,
      fieldSelectionEnabled: cfg.fieldSelection?.enabled,
      allowedSelectFields: cfg.fieldSelection?.allowed,
      blockedSelectFields: cfg.fieldSelection?.blocked,
      alwaysIncludeFields: cfg.fieldSelection?.alwaysInclude,
      defaultSelectFields: cfg.fieldSelection?.defaults,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      transform: cfg.hooks?.transform as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // Generate Read endpoint
  if (config.read !== undefined) {
    const cfg = config.read;
    result.read = generateEndpointClass(adapters.ReadEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      allowedIncludes: cfg.includes,
      fieldSelectionEnabled: cfg.fieldSelection?.enabled,
      allowedSelectFields: cfg.fieldSelection?.allowed,
      blockedSelectFields: cfg.fieldSelection?.blocked,
      alwaysIncludeFields: cfg.fieldSelection?.alwaysInclude,
      defaultSelectFields: cfg.fieldSelection?.defaults,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      transform: cfg.hooks?.transform as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // Generate Update endpoint
  if (config.update !== undefined) {
    const cfg = config.update;
    result.update = generateEndpointClass(adapters.UpdateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      bodySchema: cfg.bodySchema,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      allowedUpdateFields: cfg.fields?.allowed,
      blockedUpdateFields: cfg.fields?.blocked,
      allowNestedWrites: cfg.nestedWrites,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      transform: cfg.hooks?.transform as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // Generate Delete endpoint
  if (config.delete !== undefined) {
    const cfg = config.delete;
    result.delete = generateEndpointClass(adapters.DeleteEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      includeCascadeResults: cfg.includeCascadeResults,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // ----- Extended-verb dispatch arms -----
  // Each arm fires only when both the config slot is present AND the adapter
  // bundle ships the matching endpoint base class.

  // Generate Search endpoint
  if (config.search !== undefined && adapters.SearchEndpoint) {
    const cfg = config.search;
    result.search = generateEndpointClass(adapters.SearchEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.fields !== undefined ? { searchFields: cfg.fields } : {}),
        ...(cfg.mode !== undefined ? { defaultMode: cfg.mode } : {}),
      },
    });
  }

  // Generate Aggregate endpoint
  if (config.aggregate !== undefined && adapters.AggregateEndpoint) {
    const cfg = config.aggregate;
    result.aggregate = generateEndpointClass(adapters.AggregateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.fields !== undefined ? { filterFields: cfg.fields } : {}),
      },
    });
  }

  // Generate Restore endpoint
  if (config.restore !== undefined && adapters.RestoreEndpoint) {
    const cfg = config.restore;
    result.restore = generateEndpointClass(adapters.RestoreEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  // Generate BatchCreate endpoint
  if (config.batchCreate !== undefined && adapters.BatchCreateEndpoint) {
    const cfg = config.batchCreate;
    result.batchCreate = generateEndpointClass(adapters.BatchCreateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxBatchSize !== undefined ? { maxBatchSize: cfg.maxBatchSize } : {}),
      },
    });
  }

  // Generate BatchUpdate endpoint
  if (config.batchUpdate !== undefined && adapters.BatchUpdateEndpoint) {
    const cfg = config.batchUpdate;
    result.batchUpdate = generateEndpointClass(adapters.BatchUpdateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxBatchSize !== undefined ? { maxBatchSize: cfg.maxBatchSize } : {}),
      },
    });
  }

  // Generate BatchDelete endpoint
  if (config.batchDelete !== undefined && adapters.BatchDeleteEndpoint) {
    const cfg = config.batchDelete;
    result.batchDelete = generateEndpointClass(adapters.BatchDeleteEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxBatchSize !== undefined ? { maxBatchSize: cfg.maxBatchSize } : {}),
      },
    });
  }

  // Generate BatchRestore endpoint
  if (config.batchRestore !== undefined && adapters.BatchRestoreEndpoint) {
    const cfg = config.batchRestore;
    result.batchRestore = generateEndpointClass(adapters.BatchRestoreEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxBatchSize !== undefined ? { maxBatchSize: cfg.maxBatchSize } : {}),
      },
    });
  }

  // Generate BatchUpsert endpoint
  if (config.batchUpsert !== undefined && adapters.BatchUpsertEndpoint) {
    const cfg = config.batchUpsert;
    const upsertKeys =
      typeof cfg.conflictTarget === 'string'
        ? [cfg.conflictTarget]
        : cfg.conflictTarget;
    result.batchUpsert = generateEndpointClass(adapters.BatchUpsertEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxBatchSize !== undefined ? { maxBatchSize: cfg.maxBatchSize } : {}),
        ...(upsertKeys !== undefined ? { upsertKeys } : {}),
      },
    });
  }

  // Generate Export endpoint
  if (config.export !== undefined && adapters.ExportEndpoint) {
    const cfg = config.export;
    result.export = generateEndpointClass(adapters.ExportEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      extras: {
        ...(cfg.maxRows !== undefined ? { maxExportRecords: cfg.maxRows } : {}),
        ...(cfg.formats !== undefined && cfg.formats.length > 0
          ? { defaultFormat: cfg.formats[0] }
          : {}),
      },
    });
  }

  // Generate Import endpoint
  if (config.import !== undefined && adapters.ImportEndpoint) {
    const cfg = config.import;
    result.import = generateEndpointClass(adapters.ImportEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.maxRows !== undefined ? { maxBatchSize: cfg.maxRows } : {}),
      },
    });
  }

  // Generate Upsert endpoint
  if (config.upsert !== undefined && adapters.UpsertEndpoint) {
    const cfg = config.upsert;
    const upsertKeys =
      typeof cfg.conflictTarget === 'string'
        ? [cfg.conflictTarget]
        : cfg.conflictTarget;
    result.upsert = generateEndpointClass(adapters.UpsertEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      bodySchema: cfg.bodySchema,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(upsertKeys !== undefined ? { upsertKeys } : {}),
      },
    });
  }

  // Generate Clone endpoint
  if (config.clone !== undefined && adapters.CloneEndpoint) {
    const cfg = config.clone;
    result.clone = generateEndpointClass(adapters.CloneEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
      middlewares: cfg.middlewares,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
      extras: {
        ...(cfg.fieldsToReset !== undefined ? { excludeFromClone: cfg.fieldsToReset } : {}),
      },
    });
  }

  return result;
}
