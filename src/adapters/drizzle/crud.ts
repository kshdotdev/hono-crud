import type { Env } from 'hono';
import { eq, and, isNull, isNotNull, or, asc, desc, sql } from 'drizzle-orm';
import type { SQL, Table, Column } from 'drizzle-orm';
import { getLogger } from '../../core/logger';
import { CreateEndpoint } from '../../endpoints/create';
import { ReadEndpoint } from '../../endpoints/read';
import { UpdateEndpoint } from '../../endpoints/update';
import { DeleteEndpoint } from '../../endpoints/delete';
import { ListEndpoint } from '../../endpoints/list';
import { RestoreEndpoint } from '../../endpoints/restore';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  IncludeOptions,
  RelationConfig,
  NestedUpdateInput,
  NestedWriteResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type DrizzleDatabase,
  cast,
  getTable,
  getColumn,
  loadDrizzleRelations,
  batchLoadDrizzleRelations,
  buildWhereCondition,
} from './helpers';

/**
 * Drizzle Create endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * The database can be provided in three ways:
 * 1. Direct property: `db = myDb;`
 * 2. Context injection via middleware: `c.set('db', myDb)`
 * 3. Factory function: `createDrizzleCrud(db, meta)`
 *
 * @example
 * ```ts
 * // Pattern 1: Direct property (backward compatible)
 * class UserCreate extends DrizzleCreateEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   db = db;
 * }
 *
 * // Pattern 2: Context injection (cleanest - no db property needed)
 * class UserCreate extends DrizzleCreateEndpoint<AppEnv, typeof userMeta> {
 *   _meta = userMeta;
 *   // db comes from c.set('db', myDb) in middleware
 * }
 *
 * // Pattern 3: Factory function (no _meta or db needed)
 * const User = createDrizzleCrud(db, userMeta);
 * class UserCreate extends User.Create {
 *   schema = { tags: ['Users'] };
 * }
 * ```
 */
export abstract class DrizzleCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  /**
   * Drizzle database instance.
   * Can be undefined if using context-based injection via middleware.
   */
  db?: DrizzleDatabase;

  /**
   * Whether to wrap create and nested operations in a transaction.
   * When true, the entire create operation (including nested writes) will be atomic.
   * @default false
   */
  protected useTransaction: boolean = false;

  /** Current transaction context (set during transaction execution) */
  private _tx?: DrizzleDatabase;

  /**
   * Gets the database instance to use. Checks in order:
   * 1. Transaction context (if in transaction)
   * 2. Direct property
   * 3. Context variables (if middleware injected)
   */
  protected getDb(): DrizzleDatabase {
    // Try transaction context first
    if (this._tx) return this._tx;

    // Try direct property
    if (this.db) return this.db;

    // Try context variables (middleware injection)
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;

    throw new Error(
      'Database not configured. Either:\n' +
      '1. Set db property: db = myDb;\n' +
      '2. Use middleware: c.set("db", myDb);\n' +
      '3. Use factory: createDrizzleCrud(db, meta)'
    );
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): Table | undefined {
    return (relationConfig as RelationConfig<Table>).table;
  }

  override async create(data: ModelObject<M['model']>, tx?: unknown): Promise<ModelObject<M['model']>> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await cast(db)
      .insert(table)
      .values(record)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  /**
   * Creates nested related records.
   */
  protected override async createNested(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    data: unknown,
    tx?: unknown
  ): Promise<unknown[]> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) {
      getLogger().warn(`Related table not found for ${relationName}. Add 'table' to the relation config.`);
      return [];
    }

    const items = Array.isArray(data) ? data : [data];
    const created: unknown[] = [];

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;

      const record = {
        ...item,
        id: crypto.randomUUID(),
        [relationConfig.foreignKey]: parentId,
      };

      const result = await cast(db)
        .insert(relatedTable)
        .values(record as Record<string, unknown>)
        .returning();

      if (result[0]) {
        created.push(result[0]);
      }
    }

    return created;
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return cast(this.db).transaction(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }
}

/**
 * Drizzle Read endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete filtering when the model has `softDelete` configured.
 * Soft-deleted records are excluded by default.
 *
 * Supports relation includes via `?include=relation1,relation2`.
 */
export abstract class DrizzleReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Filter out soft-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    const result = await cast(this.db)
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    if (!result[0]) {
      return null;
    }

    // Load relations if requested
    const itemWithRelations = await loadDrizzleRelations(
      this.getDb(),
      result[0] as Record<string, unknown>,
      this._meta,
      includeOptions
    );

    return itemWithRelations as ModelObject<M['model']>;
  }
}

/**
 * Drizzle Update endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete filtering when the model has `softDelete` configured.
 * Soft-deleted records cannot be updated.
 */
export abstract class DrizzleUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpdateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /**
   * Whether to wrap update and nested operations in a transaction.
   * When true, the entire update operation (including nested writes) will be atomic.
   * @default false
   */
  protected useTransaction: boolean = false;

  /** Current transaction context (set during transaction execution) */
  private _tx?: DrizzleDatabase;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DrizzleDatabase {
    if (this._tx) return this._tx;
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): Table | undefined {
    return (relationConfig as RelationConfig<Table>).table;
  }

  /**
   * Finds an existing record for audit logging.
   */
  protected override async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Filter out soft-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    const result = await cast(db)
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return (result[0] as ModelObject<M['model']>) || null;
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Filter out soft-deleted records (cannot update deleted records)
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    const result = await cast(db)
      .update(table)
      .set(data as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    return (result[0] as ModelObject<M['model']>) || null;
  }

  /**
   * Processes nested write operations.
   */
  protected override async processNestedWrites(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
    tx?: unknown
  ): Promise<NestedWriteResult> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) {
      getLogger().warn(`Related table not found for ${relationName}. Add 'table' to the relation config.`);
      return {
        created: [],
        updated: [],
        deleted: [],
        connected: [],
        disconnected: [],
      };
    }

    const result: NestedWriteResult = {
      created: [],
      updated: [],
      deleted: [],
      connected: [],
      disconnected: [],
    };

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);
    const pkColumn = getColumn(relatedTable, 'id');

    // Handle create operations
    if (operations.create) {
      const items = Array.isArray(operations.create)
        ? operations.create
        : [operations.create];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;

        const record = {
          ...item,
          id: crypto.randomUUID(),
          [relationConfig.foreignKey]: parentId,
        };

        const created = await cast(db)
          .insert(relatedTable)
          .values(record as Record<string, unknown>)
          .returning();

        if (created[0]) {
          result.created.push(created[0] as Record<string, unknown>);
        }
      }
    }

    // Handle update operations
    if (operations.update) {
      for (const item of operations.update) {
        if (!item.id) continue;

        // Verify the record belongs to this parent
        const existing = await cast(db)
          .select()
          .from(relatedTable)
          .where(and(eq(pkColumn, item.id), eq(fkColumn, parentId)))
          .limit(1);

        if (!existing[0]) continue;

        const { id, ...updateData } = item;
        const updated = await cast(db)
          .update(relatedTable)
          .set(updateData as Record<string, unknown>)
          .where(eq(pkColumn, id))
          .returning();

        if (updated[0]) {
          result.updated.push(updated[0] as Record<string, unknown>);
        }
      }
    }

    // Handle delete operations
    if (operations.delete) {
      for (const id of operations.delete) {
        // Verify the record belongs to this parent before deleting
        const deleted = await cast(db)
          .delete(relatedTable)
          .where(and(eq(pkColumn, id), eq(fkColumn, parentId)))
          .returning();

        if (deleted[0]) {
          result.deleted.push(id);
        }
      }
    }

    // Handle connect operations
    if (operations.connect) {
      for (const id of operations.connect) {
        const updated = await cast(db)
          .update(relatedTable)
          .set({ [relationConfig.foreignKey]: parentId } as Record<string, unknown>)
          .where(eq(pkColumn, id))
          .returning();

        if (updated[0]) {
          result.connected.push(id);
        }
      }
    }

    // Handle disconnect operations
    if (operations.disconnect) {
      for (const id of operations.disconnect) {
        const updated = await cast(db)
          .update(relatedTable)
          .set({ [relationConfig.foreignKey]: null } as Record<string, unknown>)
          .where(and(eq(pkColumn, id), eq(fkColumn, parentId)))
          .returning();

        if (updated[0]) {
          result.disconnected.push(id);
        }
      }
    }

    return result;
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return cast(this.db).transaction(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }
}

/**
 * Drizzle Delete endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete when the model has `softDelete` configured.
 * When soft delete is enabled, sets the deletion timestamp instead of removing the record.
 */
export abstract class DrizzleDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends DeleteEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /**
   * Whether to wrap delete and cascade operations in a transaction.
   * When true, the entire delete operation (including cascade deletes) will be atomic.
   * @default false
   */
  protected useTransaction: boolean = false;

  /** Current transaction context (set during transaction execution) */
  private _tx?: DrizzleDatabase;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DrizzleDatabase {
    if (this._tx) return this._tx;
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): Table | undefined {
    return (relationConfig as RelationConfig<Table>).table;
  }

  /**
   * Finds a record without deleting it (for constraint checks).
   */
  override async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Exclude already-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    const result = await cast(db)
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return (result[0] as ModelObject<M['model']>) || null;
  }

  override async delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // For soft delete, also exclude already-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      const result = await cast(db)
        .update(table)
        .set({ [softDeleteConfig.field]: new Date() } as Record<string, unknown>)
        .where(and(...conditions))
        .returning();

      return (result[0] as ModelObject<M['model']>) || null;
    } else {
      // Hard delete: actually remove the record
      const result = await cast(db)
        .delete(table)
        .where(and(...conditions))
        .returning();

      return (result[0] as ModelObject<M['model']>) || null;
    }
  }

  /**
   * Counts related records for restrict check.
   */
  protected override async countRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown
  ): Promise<number> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) return 0;

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);

    const result = await cast(db)
      .select({ count: sql<number>`count(*)` })
      .from(relatedTable)
      .where(eq(fkColumn, parentId));

    return Number((result as { count: number }[])[0]?.count) || 0;
  }

  /**
   * Deletes related records for cascade delete.
   */
  protected override async deleteRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown
  ): Promise<number> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) return 0;

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);

    const result = await cast(db)
      .delete(relatedTable)
      .where(eq(fkColumn, parentId))
      .returning();

    return result.length;
  }

  /**
   * Sets foreign key to null for related records.
   */
  protected override async nullifyRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown
  ): Promise<number> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) return 0;

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);

    const result = await cast(db)
      .update(relatedTable)
      .set({ [relationConfig.foreignKey]: null } as Record<string, unknown>)
      .where(eq(fkColumn, parentId))
      .returning();

    return result.length;
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return cast(this.db).transaction(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }
}

/**
 * Drizzle List endpoint with filtering, sorting, and pagination.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete filtering when the model has `softDelete` configured:
 * - By default, soft-deleted records are excluded
 * - Use `?withDeleted=true` to include deleted records
 * - Use `?onlyDeleted=true` to show only deleted records
 */
export abstract class DrizzleListEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const table = this.getTable();
    const conditions: SQL[] = [];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter
    if (softDeleteConfig.enabled) {
      const deletedAtColumn = this.getColumn(softDeleteConfig.field);

      if (filters.options.onlyDeleted) {
        // Show only deleted records
        conditions.push(isNotNull(deletedAtColumn));
      } else if (!filters.options.withDeleted) {
        // Default: exclude deleted records
        conditions.push(isNull(deletedAtColumn));
      }
      // If withDeleted=true, don't add any condition (show all)
    }

    // Apply filters
    for (const filter of filters.filters) {
      const condition = buildWhereCondition(table, filter);
      if (condition) {
        conditions.push(condition);
      }
    }

    // Apply search
    if (filters.options.search && this.searchFields.length > 0) {
      const searchConditions = this.searchFields.map((field) => {
        const column = this.getColumn(field);
        // Use LIKE with LOWER() for case-insensitive search (works with SQLite)
        return sql`LOWER(${column}) LIKE LOWER(${`%${filters.options.search}%`})`;
      });
      conditions.push(or(...searchConditions)!);
    }

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count using COUNT(*)
    const countResult = await cast(this.db)
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(whereClause);

    const totalCount = Number((countResult as { count: number }[])[0]?.count) || 0;

    // Build main query
    let query = cast(this.db).select().from(table).where(whereClause);

    // Apply sorting
    if (filters.options.order_by) {
      const orderColumn = this.getColumn(filters.options.order_by);
      const orderFn = filters.options.order_by_direction === 'desc' ? desc : asc;
      query = query.orderBy(orderFn(orderColumn));
    }

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    query = query.limit(perPage).offset((page - 1) * perPage);

    const result = await query;

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const itemsWithRelations = await batchLoadDrizzleRelations(
      this.getDb(),
      result as Record<string, unknown>[],
      this._meta,
      includeOptions
    );

    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: itemsWithRelations as ModelObject<M['model']>[],
      result_info: {
        page,
        per_page: perPage,
        total_count: totalCount,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_prev_page: page > 1,
      },
    };
  }
}

/**
 * Drizzle Restore endpoint for un-deleting soft-deleted records.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Only works with models that have `softDelete` enabled.
 * Sets the deletion timestamp back to null.
 */
export abstract class DrizzleRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RestoreEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /**
   * Whether to wrap restore operation in a transaction.
   * Useful when combined with hooks that perform additional operations.
   * @default false
   */
  protected useTransaction: boolean = false;

  /** Current transaction context (set during transaction execution) */
  private _tx?: DrizzleDatabase;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DrizzleDatabase {
    if (this._tx) return this._tx;
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    const db = (tx as DrizzleDatabase) ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Only restore records that are actually deleted
    conditions.push(isNotNull(this.getColumn(softDeleteConfig.field)));

    // Set deletedAt to null to restore the record
    const result = await cast(db)
      .update(table)
      .set({ [softDeleteConfig.field]: null } as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    return (result[0] as ModelObject<M['model']>) || null;
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return cast(this.db).transaction(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }
}
