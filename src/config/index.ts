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

import type { ZodObject, ZodRawShape } from 'zod';
import type { MetaInput, HookMode } from '../core/types';
import type { ModelObject } from '../endpoints/types';
import { generateEndpointClass } from '../core/generate-endpoint-class';


// Import memory adapters for the MemoryAdapters bundle
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
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
  config?: Record<string, Array<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'null' | 'between'>>;
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
  lookupField?: string;
  additionalFilters?: string[];
  includeCascadeResults?: boolean;
  hooks?: DeleteHooks<M>;
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
}

/**
 * Adapter bundle containing base classes for all CRUD operations.
 */
export interface AdapterBundle {
  CreateEndpoint: abstract new () => unknown;
  ListEndpoint: abstract new () => unknown;
  ReadEndpoint: abstract new () => unknown;
  UpdateEndpoint: abstract new () => unknown;
  DeleteEndpoint: abstract new () => unknown;
}

/**
 * Generated endpoints object compatible with registerCrud.
 */
export interface GeneratedEndpoints {
  create?: new () => unknown;
  list?: new () => unknown;
  read?: new () => unknown;
  update?: new () => unknown;
  delete?: new () => unknown;
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
export function defineEndpoints<M extends MetaInput>(
  config: EndpointsConfig<M>,
  adapters: AdapterBundle
): GeneratedEndpoints {
  const result: GeneratedEndpoints = {};

  // Generate Create endpoint
  if (config.create !== undefined) {
    const cfg = config.create;
    result.create = generateEndpointClass(adapters.CreateEndpoint, {
      meta: config.meta,
      schema: cfg.openapi,
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
      filterFields: cfg.filtering?.fields,
      filterConfig: cfg.filtering?.config,
      searchFields: cfg.search?.fields,
      searchFieldName: cfg.search?.paramName,
      sortFields: cfg.sorting?.fields,
      defaultSort: cfg.sorting?.default
        ? { field: cfg.sorting.default, order: cfg.sorting.defaultOrder ?? 'asc' }
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
      lookupField: cfg.lookupField,
      additionalFilters: cfg.additionalFilters,
      includeCascadeResults: cfg.includeCascadeResults,
      beforeHookMode: cfg.hooks?.beforeMode,
      afterHookMode: cfg.hooks?.afterMode,
      before: cfg.hooks?.before as ((...args: unknown[]) => unknown) | undefined,
      after: cfg.hooks?.after as ((...args: unknown[]) => unknown) | undefined,
    });
  }

  return result;
}
