/**
 * Functional API for defining CRUD endpoints.
 *
 * Thin wrappers over the internal `generateEndpointClass` factory.
 *
 * Deliberate sugar over the 5 basic verbs (create/list/read/update/delete);
 * use the config API (`defineEndpoints`) or the class API for extended verbs
 * (search, batch.*, upsert, versioning, ...).
 *
 * @example
 * ```ts
 * import { createCreate, createList } from 'hono-crud/functional';
 * import { MemoryCreateEndpoint, MemoryListEndpoint } from '@hono-crud/memory';
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
import type { ZodObject, ZodRawShape } from 'zod';
import { generateEndpointClass } from '../core/generate-endpoint-class';
import type {
  AfterDeleteHook,
  AfterUpdateHook,
  FilterConfig,
  HookContext,
  HookMode,
  MetaInput,
  OpenAPIRouteSchema,
  SortSpec,
} from '../core/types';
import type { ModelObject } from '../endpoints/types';

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
  /** The optional second argument is the engine-built `HookContext`. */
  before?: (
    data: ModelObject<M['model']>,
    ctx?: HookContext,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  after?: (
    data: ModelObject<M['model']>,
    ctx?: HookContext,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  allowNestedCreate?: string[];
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;
  /**
   * Override the request body validation schema (bypasses the generated
   * default — model schema minus primary keys and managed fields).
   */
  bodySchema?: ZodObject<ZodRawShape>;
  middlewares?: MiddlewareHandler<E>[];
}

export interface ListConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  filterFields?: string[];
  filterConfig?: FilterConfig;
  searchFields?: string[];
  searchParamName?: string;
  sortFields?: string[];
  defaultSort?: SortSpec;
  defaultPerPage?: number;
  maxPerPage?: number;
  allowedIncludes?: string[];
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];
  after?: (
    items: ModelObject<M['model']>[],
  ) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
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
  after?: (
    data: ModelObject<M['model']>,
  ) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
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
  /** The optional second argument is the engine-built `HookContext`. */
  before?: (
    data: Partial<ModelObject<M['model']>>,
    ctx?: HookContext,
  ) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  /**
   * Update after-hook — the exported `AfterUpdateHook` alias:
   * `(prior, current, ctx: HookContext)`.
   *
   * **0.10.0 — BREAKING:** signature is now `(prior, current, ctx)`. The
   * pre-mutation snapshot is observed inside the parent UPDATE's
   * transaction so consumers can compute field-level diffs without a
   * re-fetch in `before`.
   */
  after?: AfterUpdateHook<ModelObject<M['model']>>;
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;
  transform?: (item: ModelObject<M['model']>) => unknown;
  /**
   * Override the request body validation schema (bypasses the generated
   * default). Note: the override is **not** automatically wrapped in
   * `.partial()`; the caller decides which fields are required.
   */
  bodySchema?: ZodObject<ZodRawShape>;
  middlewares?: MiddlewareHandler<E>[];
}

export interface DeleteConfig<M extends MetaInput, E extends Env = Env> {
  meta: M;
  schema?: OpenAPISchema;
  lookupField?: string;
  additionalFilters?: string[];
  includeCascadeResults?: boolean;
  /** The optional second argument is the engine-built `HookContext`. */
  before?: (lookupValue: string, ctx?: HookContext) => Promise<void> | void;
  /**
   * Delete after-hook — the exported `AfterDeleteHook` alias:
   * `(prior, ctx: HookContext)`.
   *
   * **0.10.0 — BREAKING:** signature is now `(prior, ctx)`. `prior` is
   * the pre-mutation row (for soft-delete, before `deletedAt` was set),
   * observed inside the parent DELETE's transaction.
   */
  after?: AfterDeleteHook<ModelObject<M['model']>>;
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
    bodySchema: config.bodySchema,
  });
}

export function createList<
  M extends MetaInput,
  E extends Env = Env,
  B extends abstract new () => unknown = abstract new () => unknown,
>(config: ListConfig<M, E>, BaseClass: B): GeneratedClass<B> {
  return generateEndpointClass(BaseClass, {
    meta: config.meta,
    schema: config.schema,
    middlewares: config.middlewares as MiddlewareHandler[] | undefined,
    after: config.after as ((...args: unknown[]) => unknown) | undefined,
    transform: config.transform as ((...args: unknown[]) => unknown) | undefined,
    filterFields: config.filterFields,
    filterConfig: config.filterConfig,
    searchFields: config.searchFields,
    searchParamName: config.searchParamName,
    sortFields: config.sortFields,
    defaultSort: config.defaultSort,
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
    bodySchema: config.bodySchema,
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
