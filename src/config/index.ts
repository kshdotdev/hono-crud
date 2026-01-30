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

import type { Env } from 'hono';
import type { MetaInput, HookMode } from '../core/types';
import type { ModelObject } from '../endpoints/types';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CreateEndpoint: abstract new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ListEndpoint: abstract new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEndpoint: abstract new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  UpdateEndpoint: abstract new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DeleteEndpoint: abstract new () => any;
}

/**
 * Generated endpoints object compatible with registerCrud.
 */
export interface GeneratedEndpoints {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete?: new () => any;
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
    const createConfig = config.create;
    const BaseCreate = adapters.CreateEndpoint;

    result.create = class extends BaseCreate {
      _meta = config.meta;
      schema = createConfig.openapi || {};
      protected beforeHookMode: HookMode = createConfig.hooks?.beforeMode || 'sequential';
      protected afterHookMode: HookMode = createConfig.hooks?.afterMode || 'sequential';
      protected allowNestedCreate = createConfig.nestedCreate || [];

      async before(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (createConfig.hooks?.before) {
          return createConfig.hooks.before(data, tx);
        }
        return super.before(data, tx);
      }

      async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (createConfig.hooks?.after) {
          return createConfig.hooks.after(data, tx);
        }
        return super.after(data, tx);
      }
    };
  }

  // Generate List endpoint
  if (config.list !== undefined) {
    const listConfig = config.list;
    const BaseList = adapters.ListEndpoint;

    result.list = class extends BaseList {
      _meta = config.meta;
      schema = listConfig.openapi || {};
      protected filterFields = listConfig.filtering?.fields || [];
      protected filterConfig = listConfig.filtering?.config;
      protected searchFields = listConfig.search?.fields || [];
      protected searchFieldName = listConfig.search?.paramName || 'search';
      protected sortFields = listConfig.sorting?.fields || [];
      protected defaultSort = listConfig.sorting?.default
        ? { field: listConfig.sorting.default, order: listConfig.sorting.defaultOrder || 'asc' as const }
        : undefined;
      protected defaultPerPage = listConfig.pagination?.defaultPerPage || 20;
      protected maxPerPage = listConfig.pagination?.maxPerPage || 100;
      protected allowedIncludes = listConfig.includes || [];
      protected fieldSelectionEnabled = listConfig.fieldSelection?.enabled || false;
      protected allowedSelectFields = listConfig.fieldSelection?.allowed || [];
      protected blockedSelectFields = listConfig.fieldSelection?.blocked || [];
      protected alwaysIncludeFields = listConfig.fieldSelection?.alwaysInclude || [];
      protected defaultSelectFields = listConfig.fieldSelection?.defaults || [];

      async after(items: ModelObject<M['model']>[]): Promise<ModelObject<M['model']>[]> {
        if (listConfig.hooks?.after) {
          return listConfig.hooks.after(items);
        }
        return super.after(items);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (listConfig.hooks?.transform) {
          return listConfig.hooks.transform(item);
        }
        return super.transform(item);
      }
    };
  }

  // Generate Read endpoint
  if (config.read !== undefined) {
    const readConfig = config.read;
    const BaseRead = adapters.ReadEndpoint;

    result.read = class extends BaseRead {
      _meta = config.meta;
      schema = readConfig.openapi || {};
      protected lookupField = readConfig.lookupField || 'id';
      protected additionalFilters = readConfig.additionalFilters;
      protected allowedIncludes = readConfig.includes || [];
      protected fieldSelectionEnabled = readConfig.fieldSelection?.enabled || false;
      protected allowedSelectFields = readConfig.fieldSelection?.allowed || [];
      protected blockedSelectFields = readConfig.fieldSelection?.blocked || [];
      protected alwaysIncludeFields = readConfig.fieldSelection?.alwaysInclude || [];
      protected defaultSelectFields = readConfig.fieldSelection?.defaults || [];

      async after(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
        if (readConfig.hooks?.after) {
          return readConfig.hooks.after(data);
        }
        return super.after(data);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (readConfig.hooks?.transform) {
          return readConfig.hooks.transform(item);
        }
        return super.transform(item);
      }
    };
  }

  // Generate Update endpoint
  if (config.update !== undefined) {
    const updateConfig = config.update;
    const BaseUpdate = adapters.UpdateEndpoint;

    result.update = class extends BaseUpdate {
      _meta = config.meta;
      schema = updateConfig.openapi || {};
      protected lookupField = updateConfig.lookupField || 'id';
      protected additionalFilters = updateConfig.additionalFilters;
      protected allowedUpdateFields = updateConfig.fields?.allowed;
      protected blockedUpdateFields = updateConfig.fields?.blocked;
      protected allowNestedWrites = updateConfig.nestedWrites || [];
      protected beforeHookMode: HookMode = updateConfig.hooks?.beforeMode || 'sequential';
      protected afterHookMode: HookMode = updateConfig.hooks?.afterMode || 'sequential';

      async before(data: Partial<ModelObject<M['model']>>, tx?: unknown): Promise<Partial<ModelObject<M['model']>>> {
        if (updateConfig.hooks?.before) {
          return updateConfig.hooks.before(data, tx);
        }
        return super.before(data, tx);
      }

      async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (updateConfig.hooks?.after) {
          return updateConfig.hooks.after(data, tx);
        }
        return super.after(data, tx);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (updateConfig.hooks?.transform) {
          return updateConfig.hooks.transform(item);
        }
        return super.transform(item);
      }
    };
  }

  // Generate Delete endpoint
  if (config.delete !== undefined) {
    const deleteConfig = config.delete;
    const BaseDelete = adapters.DeleteEndpoint;

    result.delete = class extends BaseDelete {
      _meta = config.meta;
      schema = deleteConfig.openapi || {};
      protected lookupField = deleteConfig.lookupField || 'id';
      protected additionalFilters = deleteConfig.additionalFilters;
      protected includeCascadeResults = deleteConfig.includeCascadeResults || false;
      protected beforeHookMode: HookMode = deleteConfig.hooks?.beforeMode || 'sequential';
      protected afterHookMode: HookMode = deleteConfig.hooks?.afterMode || 'sequential';

      async before(lookupValue: string, tx?: unknown): Promise<void> {
        if (deleteConfig.hooks?.before) {
          return deleteConfig.hooks.before(lookupValue, tx);
        }
        return super.before(lookupValue, tx);
      }

      async after(deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown): Promise<void> {
        if (deleteConfig.hooks?.after) {
          return deleteConfig.hooks.after(deletedItem, cascadeResult, tx);
        }
        return super.after(deletedItem, cascadeResult, tx);
      }
    };
  }

  return result;
}
