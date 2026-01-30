/**
 * Functional API for defining CRUD endpoints.
 *
 * Factory functions that return endpoint classes compatible with `registerCrud()`.
 *
 * @example
 * ```ts
 * import { createCreate, createList, createRead, createUpdate, createDelete } from 'hono-crud';
 * import { MemoryCreateEndpoint, MemoryListEndpoint } from 'hono-crud/adapters/memory';
 *
 * const UserCreate = createCreate({
 *   meta: userMeta,
 *   schema: { tags: ['Users'], summary: 'Create user' },
 *   before: (data) => ({ ...data, createdAt: new Date() }),
 * }, MemoryCreateEndpoint);
 *
 * const UserList = createList({
 *   meta: userMeta,
 *   filterFields: ['role'],
 *   searchFields: ['name', 'email'],
 *   sortFields: ['createdAt'],
 *   defaultSort: { field: 'createdAt', order: 'desc' },
 * }, MemoryListEndpoint);
 *
 * registerCrud(app, '/users', { create: UserCreate, list: UserList });
 * ```
 */

import type { Env, MiddlewareHandler } from 'hono';
import type { MetaInput, OpenAPIRouteSchema, HookMode } from '../core/types';
import type { ModelObject } from '../endpoints/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * OpenAPI schema configuration for endpoints.
 */
type OpenAPISchema = Partial<OpenAPIRouteSchema> & {
  tags?: string[];
  summary?: string;
  description?: string;
};

/**
 * Configuration for createCreate factory function.
 */
export interface CreateConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** OpenAPI schema configuration */
  schema?: OpenAPISchema;
  /** Hook called before create */
  before?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  /** Hook called after create */
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  /** Relations that allow nested creates */
  allowNestedCreate?: string[];
  /** Hook execution mode for before hook */
  beforeHookMode?: HookMode;
  /** Hook execution mode for after hook */
  afterHookMode?: HookMode;
  /** Middleware handlers to apply to this endpoint */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Configuration for createList factory function.
 */
export interface ListConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** OpenAPI schema configuration */
  schema?: OpenAPISchema;
  /** Fields available for filtering */
  filterFields?: string[];
  /** Advanced filter configuration with operators */
  filterConfig?: Record<string, Array<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'null' | 'between'>>;
  /** Fields available for search */
  searchFields?: string[];
  /** Name of search query parameter */
  searchFieldName?: string;
  /** Fields available for sorting. Use with ?sort=fieldName */
  sortFields?: string[];
  /** Default sort configuration */
  defaultSort?: { field: string; order: 'asc' | 'desc' };
  /** Default page size */
  defaultPerPage?: number;
  /** Maximum page size */
  maxPerPage?: number;
  /** Allowed relation names for include */
  allowedIncludes?: string[];
  /** Enable field selection */
  fieldSelectionEnabled?: boolean;
  /** Allowed fields for selection */
  allowedSelectFields?: string[];
  /** Blocked fields for selection */
  blockedSelectFields?: string[];
  /** Always include these fields */
  alwaysIncludeFields?: string[];
  /** Default fields when none specified */
  defaultSelectFields?: string[];
  /** Hook called after list */
  after?: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  /** Transform function for each item */
  transform?: (item: ModelObject<M['model']>) => unknown;
  /** Middleware handlers to apply to this endpoint */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Configuration for createRead factory function.
 */
export interface ReadConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** OpenAPI schema configuration */
  schema?: OpenAPISchema;
  /** Field to use for lookup (default: 'id') */
  lookupField?: string;
  /** Additional filter fields */
  additionalFilters?: string[];
  /** Allowed relation names for include */
  allowedIncludes?: string[];
  /** Enable field selection */
  fieldSelectionEnabled?: boolean;
  /** Allowed fields for selection */
  allowedSelectFields?: string[];
  /** Blocked fields for selection */
  blockedSelectFields?: string[];
  /** Always include these fields */
  alwaysIncludeFields?: string[];
  /** Default fields when none specified */
  defaultSelectFields?: string[];
  /** Hook called after read */
  after?: (data: ModelObject<M['model']>) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  /** Transform function */
  transform?: (item: ModelObject<M['model']>) => unknown;
  /** Middleware handlers to apply to this endpoint */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Configuration for createUpdate factory function.
 */
export interface UpdateConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** OpenAPI schema configuration */
  schema?: OpenAPISchema;
  /** Field to use for lookup (default: 'id') */
  lookupField?: string;
  /** Additional filter fields */
  additionalFilters?: string[];
  /** Fields allowed to be updated */
  allowedUpdateFields?: string[];
  /** Fields blocked from updating */
  blockedUpdateFields?: string[];
  /** Relations that allow nested writes */
  allowNestedWrites?: string[];
  /** Hook called before update */
  before?: (data: Partial<ModelObject<M['model']>>, tx?: unknown) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  /** Hook called after update */
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  /** Hook execution mode for before hook */
  beforeHookMode?: HookMode;
  /** Hook execution mode for after hook */
  afterHookMode?: HookMode;
  /** Transform function */
  transform?: (item: ModelObject<M['model']>) => unknown;
  /** Middleware handlers to apply to this endpoint */
  middlewares?: MiddlewareHandler<E>[];
}

/**
 * Configuration for createDelete factory function.
 */
export interface DeleteConfig<M extends MetaInput, E extends Env = Env> {
  /** Meta configuration for the model */
  meta: M;
  /** OpenAPI schema configuration */
  schema?: OpenAPISchema;
  /** Field to use for lookup (default: 'id') */
  lookupField?: string;
  /** Additional filter fields */
  additionalFilters?: string[];
  /** Include cascade results in response */
  includeCascadeResults?: boolean;
  /** Hook called before delete */
  before?: (lookupValue: string, tx?: unknown) => Promise<void> | void;
  /** Hook called after delete */
  after?: (deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown) => Promise<void> | void;
  /** Hook execution mode for before hook */
  beforeHookMode?: HookMode;
  /** Hook execution mode for after hook */
  afterHookMode?: HookMode;
  /** Middleware handlers to apply to this endpoint */
  middlewares?: MiddlewareHandler<E>[];
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a Create endpoint class from configuration.
 *
 * @param config - Configuration for the create endpoint
 * @param BaseClass - Base endpoint class to extend (e.g., MemoryCreateEndpoint)
 * @returns A class that can be used with registerCrud
 *
 * @example
 * ```ts
 * const UserCreate = createCreate({
 *   meta: userMeta,
 *   schema: { tags: ['Users'], summary: 'Create user' },
 *   before: (data) => ({ ...data, createdAt: new Date() }),
 * }, MemoryCreateEndpoint);
 * ```
 */
export function createCreate<
  M extends MetaInput,
  E extends Env = Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  B extends abstract new () => any = abstract new () => any,
>(
  config: CreateConfig<M, E>,
  BaseClass: B
): B {
  const beforeFn = config.before;
  const afterFn = config.after;
  const middlewares = config.middlewares || [];

  // @ts-expect-error - Dynamic class creation
  const GeneratedClass = class extends BaseClass {
    static _middlewares = middlewares;
    _meta = config.meta;
    schema = config.schema || {};
    protected beforeHookMode: HookMode = config.beforeHookMode || 'sequential';
    protected afterHookMode: HookMode = config.afterHookMode || 'sequential';
    protected allowNestedCreate = config.allowNestedCreate || [];

    async before(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
      if (beforeFn) {
        return beforeFn(data, tx);
      }
      return super.before(data, tx);
    }

    async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
      if (afterFn) {
        return afterFn(data, tx);
      }
      return super.after(data, tx);
    }
  };

  return GeneratedClass;
}

/**
 * Creates a List endpoint class from configuration.
 *
 * @param config - Configuration for the list endpoint
 * @param BaseClass - Base endpoint class to extend (e.g., MemoryListEndpoint)
 * @returns A class that can be used with registerCrud
 *
 * @example
 * ```ts
 * const UserList = createList({
 *   meta: userMeta,
 *   filterFields: ['role', 'status'],
 *   searchFields: ['name', 'email'],
 *   sortFields: ['createdAt', 'name'],
 *   defaultSort: { field: 'createdAt', order: 'desc' },
 * }, MemoryListEndpoint);
 * ```
 */
export function createList<
  M extends MetaInput,
  E extends Env = Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  B extends abstract new () => any = abstract new () => any,
>(
  config: ListConfig<M, E>,
  BaseClass: B
): B {
  const afterFn = config.after;
  const transformFn = config.transform;
  const middlewares = config.middlewares || [];

  // @ts-expect-error - Dynamic class creation
  const GeneratedClass = class extends BaseClass {
    static _middlewares = middlewares;
    _meta = config.meta;
    schema = config.schema || {};
    protected filterFields = config.filterFields || [];
    protected filterConfig = config.filterConfig;
    protected searchFields = config.searchFields || [];
    protected searchFieldName = config.searchFieldName || 'search';
    protected sortFields = config.sortFields || [];
    protected defaultSort = config.defaultSort;
    protected defaultPerPage = config.defaultPerPage || 20;
    protected maxPerPage = config.maxPerPage || 100;
    protected allowedIncludes = config.allowedIncludes || [];
    protected fieldSelectionEnabled = config.fieldSelectionEnabled || false;
    protected allowedSelectFields = config.allowedSelectFields || [];
    protected blockedSelectFields = config.blockedSelectFields || [];
    protected alwaysIncludeFields = config.alwaysIncludeFields || [];
    protected defaultSelectFields = config.defaultSelectFields || [];

    async after(items: ModelObject<M['model']>[]): Promise<ModelObject<M['model']>[]> {
      if (afterFn) {
        return afterFn(items);
      }
      return super.after(items);
    }

    protected transform(item: ModelObject<M['model']>): unknown {
      if (transformFn) {
        return transformFn(item);
      }
      return super.transform(item);
    }
  };

  return GeneratedClass;
}

/**
 * Creates a Read endpoint class from configuration.
 *
 * @param config - Configuration for the read endpoint
 * @param BaseClass - Base endpoint class to extend (e.g., MemoryReadEndpoint)
 * @returns A class that can be used with registerCrud
 *
 * @example
 * ```ts
 * const UserRead = createRead({
 *   meta: userMeta,
 *   schema: { tags: ['Users'], summary: 'Get user' },
 *   allowedIncludes: ['profile', 'posts'],
 * }, MemoryReadEndpoint);
 * ```
 */
export function createRead<
  M extends MetaInput,
  E extends Env = Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  B extends abstract new () => any = abstract new () => any,
>(
  config: ReadConfig<M, E>,
  BaseClass: B
): B {
  const afterFn = config.after;
  const transformFn = config.transform;
  const middlewares = config.middlewares || [];

  // @ts-expect-error - Dynamic class creation
  const GeneratedClass = class extends BaseClass {
    static _middlewares = middlewares;
    _meta = config.meta;
    schema = config.schema || {};
    protected lookupField = config.lookupField || 'id';
    protected additionalFilters = config.additionalFilters;
    protected allowedIncludes = config.allowedIncludes || [];
    protected fieldSelectionEnabled = config.fieldSelectionEnabled || false;
    protected allowedSelectFields = config.allowedSelectFields || [];
    protected blockedSelectFields = config.blockedSelectFields || [];
    protected alwaysIncludeFields = config.alwaysIncludeFields || [];
    protected defaultSelectFields = config.defaultSelectFields || [];

    async after(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
      if (afterFn) {
        return afterFn(data);
      }
      return super.after(data);
    }

    protected transform(item: ModelObject<M['model']>): unknown {
      if (transformFn) {
        return transformFn(item);
      }
      return super.transform(item);
    }
  };

  return GeneratedClass;
}

/**
 * Creates an Update endpoint class from configuration.
 *
 * @param config - Configuration for the update endpoint
 * @param BaseClass - Base endpoint class to extend (e.g., MemoryUpdateEndpoint)
 * @returns A class that can be used with registerCrud
 *
 * @example
 * ```ts
 * const UserUpdate = createUpdate({
 *   meta: userMeta,
 *   schema: { tags: ['Users'], summary: 'Update user' },
 *   allowedUpdateFields: ['name', 'role'],
 *   before: (data) => ({ ...data, updatedAt: new Date() }),
 * }, MemoryUpdateEndpoint);
 * ```
 */
export function createUpdate<
  M extends MetaInput,
  E extends Env = Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  B extends abstract new () => any = abstract new () => any,
>(
  config: UpdateConfig<M, E>,
  BaseClass: B
): B {
  const beforeFn = config.before;
  const afterFn = config.after;
  const transformFn = config.transform;
  const middlewares = config.middlewares || [];

  // @ts-expect-error - Dynamic class creation
  const GeneratedClass = class extends BaseClass {
    static _middlewares = middlewares;
    _meta = config.meta;
    schema = config.schema || {};
    protected lookupField = config.lookupField || 'id';
    protected additionalFilters = config.additionalFilters;
    protected allowedUpdateFields = config.allowedUpdateFields;
    protected blockedUpdateFields = config.blockedUpdateFields;
    protected allowNestedWrites = config.allowNestedWrites || [];
    protected beforeHookMode: HookMode = config.beforeHookMode || 'sequential';
    protected afterHookMode: HookMode = config.afterHookMode || 'sequential';

    async before(data: Partial<ModelObject<M['model']>>, tx?: unknown): Promise<Partial<ModelObject<M['model']>>> {
      if (beforeFn) {
        return beforeFn(data, tx);
      }
      return super.before(data, tx);
    }

    async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
      if (afterFn) {
        return afterFn(data, tx);
      }
      return super.after(data, tx);
    }

    protected transform(item: ModelObject<M['model']>): unknown {
      if (transformFn) {
        return transformFn(item);
      }
      return super.transform(item);
    }
  };

  return GeneratedClass;
}

/**
 * Creates a Delete endpoint class from configuration.
 *
 * @param config - Configuration for the delete endpoint
 * @param BaseClass - Base endpoint class to extend (e.g., MemoryDeleteEndpoint)
 * @returns A class that can be used with registerCrud
 *
 * @example
 * ```ts
 * const UserDelete = createDelete({
 *   meta: userMeta,
 *   schema: { tags: ['Users'], summary: 'Delete user' },
 *   includeCascadeResults: true,
 * }, MemoryDeleteEndpoint);
 * ```
 */
export function createDelete<
  M extends MetaInput,
  E extends Env = Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  B extends abstract new () => any = abstract new () => any,
>(
  config: DeleteConfig<M, E>,
  BaseClass: B
): B {
  const beforeFn = config.before;
  const afterFn = config.after;
  const middlewares = config.middlewares || [];

  // @ts-expect-error - Dynamic class creation
  const GeneratedClass = class extends BaseClass {
    static _middlewares = middlewares;
    _meta = config.meta;
    schema = config.schema || {};
    protected lookupField = config.lookupField || 'id';
    protected additionalFilters = config.additionalFilters;
    protected includeCascadeResults = config.includeCascadeResults || false;
    protected beforeHookMode: HookMode = config.beforeHookMode || 'sequential';
    protected afterHookMode: HookMode = config.afterHookMode || 'sequential';

    async before(lookupValue: string, tx?: unknown): Promise<void> {
      if (beforeFn) {
        return beforeFn(lookupValue, tx);
      }
      return super.before(lookupValue, tx);
    }

    async after(deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown): Promise<void> {
      if (afterFn) {
        return afterFn(deletedItem, cascadeResult, tx);
      }
      return super.after(deletedItem, cascadeResult, tx);
    }
  };

  return GeneratedClass;
}
