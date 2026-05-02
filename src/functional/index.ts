/**
 * Functional API for defining CRUD endpoints.
 *
 * Thin wrappers over the internal `generateEndpointClass` factory.
 *
 * @example
 * ```ts
 * import { createCreate, createList } from 'hono-crud';
 * import { MemoryCreateEndpoint, MemoryListEndpoint } from 'hono-crud/adapters/memory';
 *
 * const UserCreate = createCreate({
 *   meta: userMeta,
 *   schema: { tags: ['Users'] },
 *   before: (data) => ({ ...data, createdAt: new Date() }),
 * }, MemoryCreateEndpoint);
 *
 * const UserList = createList({
 *   meta: userMeta,
 *   filterFields: ['role'],
 *   defaultSort: { field: 'createdAt', order: 'desc' },
 * }, MemoryListEndpoint);
 * ```
 */

import type { Env, MiddlewareHandler } from 'hono';
import type { MetaInput, OpenAPIRouteSchema, HookMode, FilterConfig } from '../core/types';
import type { ModelObject } from '../endpoints/types';
import { generateEndpointClass } from '../core/generate-endpoint-class';

// ============================================================================
// Type Definitions
// ============================================================================

type GeneratedClass<B extends abstract new () => unknown> = B & (new () => InstanceType<B>);

type OpenAPISchema = Partial<OpenAPIRouteSchema> & {
  tags?: string[];
  summary?: string;
  description?: string;
};

export interface CreateConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  before?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  allowNestedCreate?: string[];
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;
  middlewares?: MiddlewareHandler<E>[];
}

export interface ListConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  filterFields?: string[];
  filterConfig?: FilterConfig;
  searchFields?: string[];
  searchFieldName?: string;
  sortFields?: string[];
  orderByFields?: string[];
  defaultSort?: { field: string; order: 'asc' | 'desc' };
  defaultOrderBy?: string;
  defaultOrderDirection?: 'asc' | 'desc';
  defaultPerPage?: number;
  maxPerPage?: number;
  allowedIncludes?: string[];
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];
  after?: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  transform?: (item: ModelObject<M['model']>) => unknown;
  middlewares?: MiddlewareHandler<E>[];
}

export interface ReadConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  lookupField?: string;
  additionalFilters?: string[];
  allowedIncludes?: string[];
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];
  after?: (data: ModelObject<M['model']>) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  transform?: (item: ModelObject<M['model']>) => unknown;
  middlewares?: MiddlewareHandler<E>[];
}

export interface UpdateConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  lookupField?: string;
  additionalFilters?: string[];
  allowedUpdateFields?: string[];
  blockedUpdateFields?: string[];
  allowNestedWrites?: string[];
  before?: (data: Partial<ModelObject<M['model']>>, tx?: unknown) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;
  transform?: (item: ModelObject<M['model']>) => unknown;
  middlewares?: MiddlewareHandler<E>[];
}

export interface DeleteConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  lookupField?: string;
  additionalFilters?: string[];
  includeCascadeResults?: boolean;
  before?: (lookupValue: string, tx?: unknown) => Promise<void> | void;
  after?: (deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown) => Promise<void> | void;
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;
  middlewares?: MiddlewareHandler<E>[];
}

// ============================================================================
// Factory functions (thin wrappers over generateEndpointClass)
// ============================================================================

export function createCreate<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: CreateConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    before: config.before as ((...args: unknown[]) => unknown) | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    beforeHookMode: config.beforeHookMode,
    afterHookMode: config.afterHookMode,
    allowNestedCreate: config.allowNestedCreate,
  });
}

export function createList<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: ListConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  const defaultSort = config.defaultSort ??
    (config.defaultOrderBy
      ? { field: config.defaultOrderBy, order: config.defaultOrderDirection ?? 'asc' }
      : undefined);

  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    transform: config.transform as ((...args: unknown[]) => unknown) | undefined,
    filterFields: config.filterFields,
    filterConfig: config.filterConfig,
    searchFields: config.searchFields,
    searchFieldName: config.searchFieldName,
    sortFields: config.sortFields ?? config.orderByFields,
    defaultSort,
    defaultPerPage: config.defaultPerPage,
    maxPerPage: config.maxPerPage,
    allowedIncludes: config.allowedIncludes,
    fieldSelectionEnabled: config.fieldSelectionEnabled,
    allowedSelectFields: config.allowedSelectFields,
    blockedSelectFields: config.blockedSelectFields,
    alwaysIncludeFields: config.alwaysIncludeFields,
    defaultSelectFields: config.defaultSelectFields,
  });
}

export function createRead<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: ReadConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    transform: config.transform as ((...args: unknown[]) => unknown) | undefined,
    lookupField: config.lookupField,
    additionalFilters: config.additionalFilters,
    allowedIncludes: config.allowedIncludes,
    fieldSelectionEnabled: config.fieldSelectionEnabled,
    allowedSelectFields: config.allowedSelectFields,
    blockedSelectFields: config.blockedSelectFields,
    alwaysIncludeFields: config.alwaysIncludeFields,
    defaultSelectFields: config.defaultSelectFields,
  });
}

export function createUpdate<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: UpdateConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    before: config.before as ((...args: unknown[]) => unknown) | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    transform: config.transform as ((...args: unknown[]) => unknown) | undefined,
    beforeHookMode: config.beforeHookMode,
    afterHookMode: config.afterHookMode,
    lookupField: config.lookupField,
    additionalFilters: config.additionalFilters,
    allowedUpdateFields: config.allowedUpdateFields,
    blockedUpdateFields: config.blockedUpdateFields,
    allowNestedWrites: config.allowNestedWrites,
  });
}

export function createDelete<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: DeleteConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    before: config.before as ((...args: unknown[]) => unknown) | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    beforeHookMode: config.beforeHookMode,
    afterHookMode: config.afterHookMode,
    lookupField: config.lookupField,
    additionalFilters: config.additionalFilters,
    includeCascadeResults: config.includeCascadeResults,
  });
}
