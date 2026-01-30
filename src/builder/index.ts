/**
 * Builder/Fluent API for defining CRUD endpoints.
 *
 * Chainable API with `.build()` at the end to create endpoint classes.
 *
 * @example
 * ```ts
 * import { crud } from 'hono-crud';
 * import { MemoryListEndpoint, MemoryCreateEndpoint } from 'hono-crud/adapters/memory';
 *
 * const UserList = crud(userMeta).list()
 *   .tags('Users')
 *   .summary('List users')
 *   .filter('role', 'status')
 *   .search('name', 'email')
 *   .orderBy('name', 'createdAt')
 *   .defaultOrder('createdAt', 'desc')
 *   .pagination(20, 100)
 *   .include('profile', 'posts')
 *   .build(MemoryListEndpoint);
 *
 * const UserCreate = crud(userMeta).create()
 *   .tags('Users')
 *   .summary('Create user')
 *   .before((data) => ({ ...data, createdAt: new Date() }))
 *   .build(MemoryCreateEndpoint);
 *
 * registerCrud(app, '/users', { list: UserList, create: UserCreate });
 * ```
 */

import type { Env, MiddlewareHandler } from 'hono';
import type { MetaInput, HookMode } from '../core/types';
import type { ModelObject } from '../endpoints/types';

// ============================================================================
// Create Builder
// ============================================================================

/**
 * Builder for Create endpoints.
 */
export class CreateBuilder<M extends MetaInput, E extends Env = Env> {
  private _schema: Record<string, unknown> = {};
  private _before?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  private _after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  private _beforeHookMode: HookMode = 'sequential';
  private _afterHookMode: HookMode = 'sequential';
  private _allowNestedCreate: string[] = [];
  private _middlewares: MiddlewareHandler<E>[] = [];

  constructor(private readonly meta: M) {}

  /** Add middleware to this endpoint */
  middleware(...handlers: MiddlewareHandler<E>[]): this {
    this._middlewares.push(...handlers);
    return this;
  }

  /** Set OpenAPI tags */
  tags(...tags: string[]): this {
    this._schema.tags = tags;
    return this;
  }

  /** Set OpenAPI summary */
  summary(summary: string): this {
    this._schema.summary = summary;
    return this;
  }

  /** Set OpenAPI description */
  description(description: string): this {
    this._schema.description = description;
    return this;
  }

  /** Set before hook */
  before(fn: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>): this {
    this._before = fn;
    return this;
  }

  /** Set after hook */
  after(fn: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>): this {
    this._after = fn;
    return this;
  }

  /** Set before hook mode */
  beforeMode(mode: HookMode): this {
    this._beforeHookMode = mode;
    return this;
  }

  /** Set after hook mode */
  afterMode(mode: HookMode): this {
    this._afterHookMode = mode;
    return this;
  }

  /** Set relations that allow nested creates */
  nestedCreate(...relations: string[]): this {
    this._allowNestedCreate = relations;
    return this;
  }

  /**
   * Build the endpoint class.
   *
   * @param BaseClass - The adapter-specific base class to extend
   * @returns A class that can be used with registerCrud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build<B extends abstract new () => any>(BaseClass: B): B {
    const config = {
      meta: this.meta,
      schema: this._schema,
      before: this._before,
      after: this._after,
      beforeHookMode: this._beforeHookMode,
      afterHookMode: this._afterHookMode,
      allowNestedCreate: this._allowNestedCreate,
    };
    const middlewares = this._middlewares;

    // @ts-expect-error - Dynamic class creation
    const GeneratedClass = class extends BaseClass {
      static _middlewares = middlewares;
      _meta = config.meta;
      schema = config.schema || {};
      protected beforeHookMode: HookMode = config.beforeHookMode;
      protected afterHookMode: HookMode = config.afterHookMode;
      protected allowNestedCreate = config.allowNestedCreate;

      async before(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (config.before) {
          return config.before(data, tx);
        }
        return super.before(data, tx);
      }

      async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (config.after) {
          return config.after(data, tx);
        }
        return super.after(data, tx);
      }
    };

    return GeneratedClass;
  }
}

// ============================================================================
// List Builder
// ============================================================================

/**
 * Builder for List endpoints.
 */
export class ListBuilder<M extends MetaInput, E extends Env = Env> {
  private _schema: Record<string, unknown> = {};
  private _filterFields: string[] = [];
  private _filterConfig?: Record<string, Array<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'null' | 'between'>>;
  private _searchFields: string[] = [];
  private _searchFieldName = 'search';
  private _sortFields: string[] = [];
  private _defaultSort?: { field: string; order: 'asc' | 'desc' };
  private _defaultPerPage = 20;
  private _maxPerPage = 100;
  private _allowedIncludes: string[] = [];
  private _fieldSelectionEnabled = false;
  private _allowedSelectFields: string[] = [];
  private _blockedSelectFields: string[] = [];
  private _alwaysIncludeFields: string[] = [];
  private _defaultSelectFields: string[] = [];
  private _after?: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[];
  private _transform?: (item: ModelObject<M['model']>) => unknown;
  private _middlewares: MiddlewareHandler<E>[] = [];

  constructor(private readonly meta: M) {}

  /** Add middleware to this endpoint */
  middleware(...handlers: MiddlewareHandler<E>[]): this {
    this._middlewares.push(...handlers);
    return this;
  }

  /** Set OpenAPI tags */
  tags(...tags: string[]): this {
    this._schema.tags = tags;
    return this;
  }

  /** Set OpenAPI summary */
  summary(summary: string): this {
    this._schema.summary = summary;
    return this;
  }

  /** Set OpenAPI description */
  description(description: string): this {
    this._schema.description = description;
    return this;
  }

  /** Set filter fields */
  filter(...fields: string[]): this {
    this._filterFields = fields;
    return this;
  }

  /** Set advanced filter config with operators */
  filterWith(config: Record<string, Array<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'null' | 'between'>>): this {
    this._filterConfig = config;
    return this;
  }

  /** Set search fields */
  search(...fields: string[]): this {
    this._searchFields = fields;
    return this;
  }

  /** Set search query parameter name */
  searchParam(name: string): this {
    this._searchFieldName = name;
    return this;
  }

  /** Set sortable fields. Use with ?sort=fieldName&order=asc|desc */
  sortable(...fields: string[]): this {
    this._sortFields = fields;
    return this;
  }

  /** Set default sort */
  defaultSort(field: string, order: 'asc' | 'desc' = 'asc'): this {
    this._defaultSort = { field, order };
    return this;
  }

  /** Set pagination defaults */
  pagination(defaultPerPage: number, maxPerPage?: number): this {
    this._defaultPerPage = defaultPerPage;
    if (maxPerPage !== undefined) {
      this._maxPerPage = maxPerPage;
    }
    return this;
  }

  /** Set allowed includes */
  include(...relations: string[]): this {
    this._allowedIncludes = relations;
    return this;
  }

  /** Enable field selection */
  fieldSelection(options?: {
    allowed?: string[];
    blocked?: string[];
    alwaysInclude?: string[];
    defaults?: string[];
  }): this {
    this._fieldSelectionEnabled = true;
    if (options?.allowed) this._allowedSelectFields = options.allowed;
    if (options?.blocked) this._blockedSelectFields = options.blocked;
    if (options?.alwaysInclude) this._alwaysIncludeFields = options.alwaysInclude;
    if (options?.defaults) this._defaultSelectFields = options.defaults;
    return this;
  }

  /** Set after hook */
  after(fn: (items: ModelObject<M['model']>[]) => Promise<ModelObject<M['model']>[]> | ModelObject<M['model']>[]): this {
    this._after = fn;
    return this;
  }

  /** Set transform function */
  transform(fn: (item: ModelObject<M['model']>) => unknown): this {
    this._transform = fn;
    return this;
  }

  /**
   * Build the endpoint class.
   *
   * @param BaseClass - The adapter-specific base class to extend
   * @returns A class that can be used with registerCrud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build<B extends abstract new () => any>(BaseClass: B): B {
    const config = {
      meta: this.meta,
      schema: this._schema,
      filterFields: this._filterFields,
      filterConfig: this._filterConfig,
      searchFields: this._searchFields,
      searchFieldName: this._searchFieldName,
      sortFields: this._sortFields,
      defaultSort: this._defaultSort,
      defaultPerPage: this._defaultPerPage,
      maxPerPage: this._maxPerPage,
      allowedIncludes: this._allowedIncludes,
      fieldSelectionEnabled: this._fieldSelectionEnabled,
      allowedSelectFields: this._allowedSelectFields,
      blockedSelectFields: this._blockedSelectFields,
      alwaysIncludeFields: this._alwaysIncludeFields,
      defaultSelectFields: this._defaultSelectFields,
      after: this._after,
      transform: this._transform,
    };
    const middlewares = this._middlewares;

    // @ts-expect-error - Dynamic class creation
    const GeneratedClass = class extends BaseClass {
      static _middlewares = middlewares;
      _meta = config.meta;
      schema = config.schema || {};
      protected filterFields = config.filterFields;
      protected filterConfig = config.filterConfig;
      protected searchFields = config.searchFields;
      protected searchFieldName = config.searchFieldName;
      protected sortFields = config.sortFields;
      protected defaultSort = config.defaultSort;
      protected defaultPerPage = config.defaultPerPage;
      protected maxPerPage = config.maxPerPage;
      protected allowedIncludes = config.allowedIncludes;
      protected fieldSelectionEnabled = config.fieldSelectionEnabled;
      protected allowedSelectFields = config.allowedSelectFields;
      protected blockedSelectFields = config.blockedSelectFields;
      protected alwaysIncludeFields = config.alwaysIncludeFields;
      protected defaultSelectFields = config.defaultSelectFields;

      async after(items: ModelObject<M['model']>[]): Promise<ModelObject<M['model']>[]> {
        if (config.after) {
          return config.after(items);
        }
        return super.after(items);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (config.transform) {
          return config.transform(item);
        }
        return super.transform(item);
      }
    };

    return GeneratedClass;
  }
}

// ============================================================================
// Read Builder
// ============================================================================

/**
 * Builder for Read endpoints.
 */
export class ReadBuilder<M extends MetaInput, E extends Env = Env> {
  private _schema: Record<string, unknown> = {};
  private _lookupField = 'id';
  private _additionalFilters?: string[];
  private _allowedIncludes: string[] = [];
  private _fieldSelectionEnabled = false;
  private _allowedSelectFields: string[] = [];
  private _blockedSelectFields: string[] = [];
  private _alwaysIncludeFields: string[] = [];
  private _defaultSelectFields: string[] = [];
  private _after?: (data: ModelObject<M['model']>) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  private _transform?: (item: ModelObject<M['model']>) => unknown;
  private _middlewares: MiddlewareHandler<E>[] = [];

  constructor(private readonly meta: M) {}

  /** Add middleware to this endpoint */
  middleware(...handlers: MiddlewareHandler<E>[]): this {
    this._middlewares.push(...handlers);
    return this;
  }

  /** Set OpenAPI tags */
  tags(...tags: string[]): this {
    this._schema.tags = tags;
    return this;
  }

  /** Set OpenAPI summary */
  summary(summary: string): this {
    this._schema.summary = summary;
    return this;
  }

  /** Set OpenAPI description */
  description(description: string): this {
    this._schema.description = description;
    return this;
  }

  /** Set lookup field */
  lookupField(field: string): this {
    this._lookupField = field;
    return this;
  }

  /** Set additional filters */
  additionalFilters(...fields: string[]): this {
    this._additionalFilters = fields;
    return this;
  }

  /** Set allowed includes */
  include(...relations: string[]): this {
    this._allowedIncludes = relations;
    return this;
  }

  /** Enable field selection */
  fieldSelection(options?: {
    allowed?: string[];
    blocked?: string[];
    alwaysInclude?: string[];
    defaults?: string[];
  }): this {
    this._fieldSelectionEnabled = true;
    if (options?.allowed) this._allowedSelectFields = options.allowed;
    if (options?.blocked) this._blockedSelectFields = options.blocked;
    if (options?.alwaysInclude) this._alwaysIncludeFields = options.alwaysInclude;
    if (options?.defaults) this._defaultSelectFields = options.defaults;
    return this;
  }

  /** Set after hook */
  after(fn: (data: ModelObject<M['model']>) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>): this {
    this._after = fn;
    return this;
  }

  /** Set transform function */
  transform(fn: (item: ModelObject<M['model']>) => unknown): this {
    this._transform = fn;
    return this;
  }

  /**
   * Build the endpoint class.
   *
   * @param BaseClass - The adapter-specific base class to extend
   * @returns A class that can be used with registerCrud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build<B extends abstract new () => any>(BaseClass: B): B {
    const config = {
      meta: this.meta,
      schema: this._schema,
      lookupField: this._lookupField,
      additionalFilters: this._additionalFilters,
      allowedIncludes: this._allowedIncludes,
      fieldSelectionEnabled: this._fieldSelectionEnabled,
      allowedSelectFields: this._allowedSelectFields,
      blockedSelectFields: this._blockedSelectFields,
      alwaysIncludeFields: this._alwaysIncludeFields,
      defaultSelectFields: this._defaultSelectFields,
      after: this._after,
      transform: this._transform,
    };
    const middlewares = this._middlewares;

    // @ts-expect-error - Dynamic class creation
    const GeneratedClass = class extends BaseClass {
      static _middlewares = middlewares;
      _meta = config.meta;
      schema = config.schema || {};
      protected lookupField = config.lookupField;
      protected additionalFilters = config.additionalFilters;
      protected allowedIncludes = config.allowedIncludes;
      protected fieldSelectionEnabled = config.fieldSelectionEnabled;
      protected allowedSelectFields = config.allowedSelectFields;
      protected blockedSelectFields = config.blockedSelectFields;
      protected alwaysIncludeFields = config.alwaysIncludeFields;
      protected defaultSelectFields = config.defaultSelectFields;

      async after(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
        if (config.after) {
          return config.after(data);
        }
        return super.after(data);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (config.transform) {
          return config.transform(item);
        }
        return super.transform(item);
      }
    };

    return GeneratedClass;
  }
}

// ============================================================================
// Update Builder
// ============================================================================

/**
 * Builder for Update endpoints.
 */
export class UpdateBuilder<M extends MetaInput, E extends Env = Env> {
  private _schema: Record<string, unknown> = {};
  private _lookupField = 'id';
  private _additionalFilters?: string[];
  private _allowedUpdateFields?: string[];
  private _blockedUpdateFields?: string[];
  private _allowNestedWrites: string[] = [];
  private _before?: (data: Partial<ModelObject<M['model']>>, tx?: unknown) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>;
  private _after?: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>;
  private _beforeHookMode: HookMode = 'sequential';
  private _afterHookMode: HookMode = 'sequential';
  private _transform?: (item: ModelObject<M['model']>) => unknown;
  private _middlewares: MiddlewareHandler<E>[] = [];

  constructor(private readonly meta: M) {}

  /** Add middleware to this endpoint */
  middleware(...handlers: MiddlewareHandler<E>[]): this {
    this._middlewares.push(...handlers);
    return this;
  }

  /** Set OpenAPI tags */
  tags(...tags: string[]): this {
    this._schema.tags = tags;
    return this;
  }

  /** Set OpenAPI summary */
  summary(summary: string): this {
    this._schema.summary = summary;
    return this;
  }

  /** Set OpenAPI description */
  description(description: string): this {
    this._schema.description = description;
    return this;
  }

  /** Set lookup field */
  lookupField(field: string): this {
    this._lookupField = field;
    return this;
  }

  /** Set additional filters */
  additionalFilters(...fields: string[]): this {
    this._additionalFilters = fields;
    return this;
  }

  /** Set allowed update fields */
  allowedFields(...fields: string[]): this {
    this._allowedUpdateFields = fields;
    return this;
  }

  /** Set blocked update fields */
  blockedFields(...fields: string[]): this {
    this._blockedUpdateFields = fields;
    return this;
  }

  /** Set relations that allow nested writes */
  nestedWrites(...relations: string[]): this {
    this._allowNestedWrites = relations;
    return this;
  }

  /** Set before hook */
  before(fn: (data: Partial<ModelObject<M['model']>>, tx?: unknown) => Promise<Partial<ModelObject<M['model']>>> | Partial<ModelObject<M['model']>>): this {
    this._before = fn;
    return this;
  }

  /** Set after hook */
  after(fn: (data: ModelObject<M['model']>, tx?: unknown) => Promise<ModelObject<M['model']>> | ModelObject<M['model']>): this {
    this._after = fn;
    return this;
  }

  /** Set before hook mode */
  beforeMode(mode: HookMode): this {
    this._beforeHookMode = mode;
    return this;
  }

  /** Set after hook mode */
  afterMode(mode: HookMode): this {
    this._afterHookMode = mode;
    return this;
  }

  /** Set transform function */
  transform(fn: (item: ModelObject<M['model']>) => unknown): this {
    this._transform = fn;
    return this;
  }

  /**
   * Build the endpoint class.
   *
   * @param BaseClass - The adapter-specific base class to extend
   * @returns A class that can be used with registerCrud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build<B extends abstract new () => any>(BaseClass: B): B {
    const config = {
      meta: this.meta,
      schema: this._schema,
      lookupField: this._lookupField,
      additionalFilters: this._additionalFilters,
      allowedUpdateFields: this._allowedUpdateFields,
      blockedUpdateFields: this._blockedUpdateFields,
      allowNestedWrites: this._allowNestedWrites,
      before: this._before,
      after: this._after,
      beforeHookMode: this._beforeHookMode,
      afterHookMode: this._afterHookMode,
      transform: this._transform,
    };
    const middlewares = this._middlewares;

    // @ts-expect-error - Dynamic class creation
    const GeneratedClass = class extends BaseClass {
      static _middlewares = middlewares;
      _meta = config.meta;
      schema = config.schema || {};
      protected lookupField = config.lookupField;
      protected additionalFilters = config.additionalFilters;
      protected allowedUpdateFields = config.allowedUpdateFields;
      protected blockedUpdateFields = config.blockedUpdateFields;
      protected allowNestedWrites = config.allowNestedWrites;
      protected beforeHookMode: HookMode = config.beforeHookMode;
      protected afterHookMode: HookMode = config.afterHookMode;

      async before(data: Partial<ModelObject<M['model']>>, tx?: unknown): Promise<Partial<ModelObject<M['model']>>> {
        if (config.before) {
          return config.before(data, tx);
        }
        return super.before(data, tx);
      }

      async after(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
        if (config.after) {
          return config.after(data, tx);
        }
        return super.after(data, tx);
      }

      protected transform(item: ModelObject<M['model']>): unknown {
        if (config.transform) {
          return config.transform(item);
        }
        return super.transform(item);
      }
    };

    return GeneratedClass;
  }
}

// ============================================================================
// Delete Builder
// ============================================================================

/**
 * Builder for Delete endpoints.
 */
export class DeleteBuilder<M extends MetaInput, E extends Env = Env> {
  private _schema: Record<string, unknown> = {};
  private _lookupField = 'id';
  private _additionalFilters?: string[];
  private _includeCascadeResults = false;
  private _before?: (lookupValue: string, tx?: unknown) => Promise<void> | void;
  private _after?: (deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown) => Promise<void> | void;
  private _beforeHookMode: HookMode = 'sequential';
  private _afterHookMode: HookMode = 'sequential';
  private _middlewares: MiddlewareHandler<E>[] = [];

  constructor(private readonly meta: M) {}

  /** Add middleware to this endpoint */
  middleware(...handlers: MiddlewareHandler<E>[]): this {
    this._middlewares.push(...handlers);
    return this;
  }

  /** Set OpenAPI tags */
  tags(...tags: string[]): this {
    this._schema.tags = tags;
    return this;
  }

  /** Set OpenAPI summary */
  summary(summary: string): this {
    this._schema.summary = summary;
    return this;
  }

  /** Set OpenAPI description */
  description(description: string): this {
    this._schema.description = description;
    return this;
  }

  /** Set lookup field */
  lookupField(field: string): this {
    this._lookupField = field;
    return this;
  }

  /** Set additional filters */
  additionalFilters(...fields: string[]): this {
    this._additionalFilters = fields;
    return this;
  }

  /** Include cascade results in response */
  includeCascade(include = true): this {
    this._includeCascadeResults = include;
    return this;
  }

  /** Set before hook */
  before(fn: (lookupValue: string, tx?: unknown) => Promise<void> | void): this {
    this._before = fn;
    return this;
  }

  /** Set after hook */
  after(fn: (deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown) => Promise<void> | void): this {
    this._after = fn;
    return this;
  }

  /** Set before hook mode */
  beforeMode(mode: HookMode): this {
    this._beforeHookMode = mode;
    return this;
  }

  /** Set after hook mode */
  afterMode(mode: HookMode): this {
    this._afterHookMode = mode;
    return this;
  }

  /**
   * Build the endpoint class.
   *
   * @param BaseClass - The adapter-specific base class to extend
   * @returns A class that can be used with registerCrud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build<B extends abstract new () => any>(BaseClass: B): B {
    const config = {
      meta: this.meta,
      schema: this._schema,
      lookupField: this._lookupField,
      additionalFilters: this._additionalFilters,
      includeCascadeResults: this._includeCascadeResults,
      before: this._before,
      after: this._after,
      beforeHookMode: this._beforeHookMode,
      afterHookMode: this._afterHookMode,
    };
    const middlewares = this._middlewares;

    // @ts-expect-error - Dynamic class creation
    const GeneratedClass = class extends BaseClass {
      static _middlewares = middlewares;
      _meta = config.meta;
      schema = config.schema || {};
      protected lookupField = config.lookupField;
      protected additionalFilters = config.additionalFilters;
      protected includeCascadeResults = config.includeCascadeResults;
      protected beforeHookMode: HookMode = config.beforeHookMode;
      protected afterHookMode: HookMode = config.afterHookMode;

      async before(lookupValue: string, tx?: unknown): Promise<void> {
        if (config.before) {
          return config.before(lookupValue, tx);
        }
        return super.before(lookupValue, tx);
      }

      async after(deletedItem: ModelObject<M['model']>, cascadeResult?: unknown, tx?: unknown): Promise<void> {
        if (config.after) {
          return config.after(deletedItem, cascadeResult, tx);
        }
        return super.after(deletedItem, cascadeResult, tx);
      }
    };

    return GeneratedClass;
  }
}

// ============================================================================
// CRUD Builder (Entry Point)
// ============================================================================

/**
 * Entry point builder for CRUD endpoints.
 */
export class CrudBuilder<M extends MetaInput, E extends Env = Env> {
  constructor(private readonly meta: M) {}

  /** Start building a Create endpoint */
  create(): CreateBuilder<M, E> {
    return new CreateBuilder<M, E>(this.meta);
  }

  /** Start building a List endpoint */
  list(): ListBuilder<M, E> {
    return new ListBuilder<M, E>(this.meta);
  }

  /** Start building a Read endpoint */
  read(): ReadBuilder<M, E> {
    return new ReadBuilder<M, E>(this.meta);
  }

  /** Start building an Update endpoint */
  update(): UpdateBuilder<M, E> {
    return new UpdateBuilder<M, E>(this.meta);
  }

  /** Start building a Delete endpoint */
  delete(): DeleteBuilder<M, E> {
    return new DeleteBuilder<M, E>(this.meta);
  }
}

// ============================================================================
// Entry Function
// ============================================================================

/**
 * Entry point for the fluent/builder API.
 *
 * @param meta - The meta configuration for the model
 * @returns A CrudBuilder to start building endpoints
 *
 * @example
 * ```ts
 * const UserList = crud(userMeta).list()
 *   .tags('Users')
 *   .filter('role')
 *   .search('name', 'email')
 *   .build(MemoryListEndpoint);
 *
 * const UserCreate = crud(userMeta).create()
 *   .tags('Users')
 *   .before((data) => ({ ...data, createdAt: new Date() }))
 *   .build(MemoryCreateEndpoint);
 * ```
 */
export function crud<M extends MetaInput, E extends Env = Env>(meta: M): CrudBuilder<M, E> {
  return new CrudBuilder<M, E>(meta);
}
