import { eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Env } from 'hono';
import { buildCursorPage, getLogger } from 'hono-crud/internal';
import { CreateEndpoint } from 'hono-crud/internal';
import { ReadEndpoint } from 'hono-crud/internal';
import { UpdateEndpoint } from 'hono-crud/internal';
import { DeleteEndpoint } from 'hono-crud/internal';
import { ListEndpoint } from 'hono-crud/internal';
import { RestoreEndpoint } from 'hono-crud/internal';
import type {
  IncludeOptions,
  ListFilters,
  MetaInput,
  NestedUpdateInput,
  NestedWriteResult,
  PaginatedResult,
  RelationConfig,
} from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { getDrizzleDb } from './connection';
import {
  type DrizzleColumn,
  type DrizzleDatabaseConstraint,
  type DrizzleDialect,
  type DrizzleSql,
  type DrizzleTable,
  and,
  batchLoadDrizzleRelations,
  buildPaginatedResult,
  cast,
  executeDrizzleListQuery,
  getColumn,
  getTable,
  loadDrizzleRelations,
  readCount,
} from './helpers';

/**
 * Drizzle Create endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * The database can be provided in three ways:
 * 1. Direct property: `db = myDb;`
 * 2. Context injection via middleware: `c.set('db', myDb)` (the `'db'` slot is
 *    canonically `CONTEXT_KEYS.db`)
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
 *   // db comes from c.set('db', myDb) (CONTEXT_KEYS.db) in middleware
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends CreateEndpoint<E, M> {
  /**
   * Drizzle database instance.
   * Can be undefined if using context-based injection via middleware.
   */
  db?: DB;

  /**
   * Whether to wrap create and nested operations in a transaction.
   * When true, the entire create operation (including nested writes) will be atomic.
   * @default false
   */
  protected useTransaction = false;

  /** Current transaction context (set during transaction execution) */
  protected declare _tx?: DrizzleDatabaseConstraint;

  /**
   * Gets the database instance to use. Checks in order:
   * 1. Transaction context (if in transaction)
   * 2. Direct property
   * 3. Context variables (if middleware injected)
   */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): DrizzleTable | undefined {
    return (relationConfig as RelationConfig<DrizzleTable>).table;
  }

  override async create(
    data: ModelObject<M['model']>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']>> {
    const db = tx ?? this.getDb();
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle');

    const result = await cast<ModelObject<M['model']>>(db).insert(table).values(record).returning();

    return result[0];
  }

  /**
   * Creates nested related records.
   */
  protected override async createNested(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    data: unknown,
    tx?: unknown,
  ): Promise<unknown[]> {
    const db = tx ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) {
      getLogger().warn(
        `Related table not found for ${relationName}. Add 'table' to the relation config.`,
      );
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
    return cast(this.getDb()).transaction(async (tx) => {
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends ReadEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /** Gets the database instance from property or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions,
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

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

    const result = await cast<ModelObject<M['model']>>(this.getDb())
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
      result[0],
      this._meta,
      includeOptions,
    );

    return itemWithRelations;
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends UpdateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /**
   * Whether to wrap update and nested operations in a transaction.
   * When true, the entire update operation (including nested writes) will be atomic.
   * @default false
   */
  protected useTransaction = false;

  /** Current transaction context (set during transaction execution) */
  protected declare _tx?: DrizzleDatabaseConstraint;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): DrizzleTable | undefined {
    return (relationConfig as RelationConfig<DrizzleTable>).table;
  }

  /**
   * Finds an existing record for audit logging.
   */
  protected override async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']> | null> {
    const db = tx ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

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

    const result = await cast<ModelObject<M['model']>>(db)
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return result[0] || null;
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']> | null> {
    const db = tx ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

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

    const result = await cast<ModelObject<M['model']>>(db)
      .update(table)
      .set(this.applyManagedUpdateFields(data as Record<string, unknown>))
      .where(and(...conditions))
      .returning();

    return result[0] || null;
  }

  /**
   * Processes nested write operations.
   */
  protected override async processNestedWrites(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
    tx?: unknown,
  ): Promise<NestedWriteResult> {
    const db = tx ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) {
      getLogger().warn(
        `Related table not found for ${relationName}. Add 'table' to the relation config.`,
      );
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
      const items = Array.isArray(operations.create) ? operations.create : [operations.create];
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
    return cast(this.getDb()).transaction(async (tx) => {
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends DeleteEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /**
   * Whether to wrap delete and cascade operations in a transaction.
   * When true, the entire delete operation (including cascade deletes) will be atomic.
   * @default false
   */
  protected useTransaction = false;

  /** Current transaction context (set during transaction execution) */
  protected declare _tx?: DrizzleDatabaseConstraint;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  /**
   * Gets a related table from the relation config.
   */
  protected getRelatedTable(relationConfig: RelationConfig): DrizzleTable | undefined {
    return (relationConfig as RelationConfig<DrizzleTable>).table;
  }

  /**
   * Finds a record without deleting it (for constraint checks).
   */
  override async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']> | null> {
    const db = tx ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

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

    const result = await cast<ModelObject<M['model']>>(db)
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return result[0] || null;
  }

  override async delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']> | null> {
    const db = tx ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

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
      const result = await cast<ModelObject<M['model']>>(db)
        .update(table)
        .set({ [softDeleteConfig.field]: new Date() } as Record<string, unknown>)
        .where(and(...conditions))
        .returning();

      return result[0] || null;
    } else {
      // Hard delete: actually remove the record
      const result = await cast<ModelObject<M['model']>>(db)
        .delete(table)
        .where(and(...conditions))
        .returning();

      return result[0] || null;
    }
  }

  /**
   * Counts related records for restrict check.
   */
  protected override async countRelated(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown,
  ): Promise<number> {
    const db = tx ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) return 0;

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);

    const result = await cast(db)
      .select({ count: sql<number>`count(*)` })
      .from(relatedTable)
      .where(eq(fkColumn, parentId));

    return readCount(result);
  }

  /**
   * Deletes related records for cascade delete.
   */
  protected override async deleteRelated(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown,
  ): Promise<number> {
    const db = tx ?? this.getDb();
    const relatedTable = this.getRelatedTable(relationConfig);
    if (!relatedTable) return 0;

    const fkColumn = getColumn(relatedTable, relationConfig.foreignKey);

    const result = await cast(db).delete(relatedTable).where(eq(fkColumn, parentId)).returning();

    return result.length;
  }

  /**
   * Sets foreign key to null for related records.
   */
  protected override async nullifyRelated(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    tx?: unknown,
  ): Promise<number> {
    const db = tx ?? this.getDb();
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
    return cast(this.getDb()).transaction(async (tx) => {
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends ListEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /**
   * SQL dialect of the underlying Drizzle database.
   *
   * Drives the substring-match function emitted on the `?search=` path:
   * `INSTR` for sqlite, `POSITION` for pg, `LOCATE` for mysql — matching
   * how the dedicated search endpoint (`DrizzleSearchEndpoint`) and the
   * export endpoint (`DrizzleExportEndpoint`) emit search SQL. Set via
   * {@link createDrizzleCrud}'s `options.dialect`, or override in your
   * subclass. Defaults to `'sqlite'` for backward compatibility with
   * pre-existing portable behavior.
   *
   * See {@link DrizzleUpsertEndpoint.dialect} for full semantics.
   */
  protected dialect: DrizzleDialect = 'sqlite';

  /** Keyset cursor pagination is implemented (`WHERE cursorField > decoded`). */
  protected override supportsCursorPagination = true;

  /** Gets the database instance from property or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic (filters, search, sorting, pagination)
    const queryResult = await executeDrizzleListQuery<ModelObject<M['model']>>({
      db: this.getDb(),
      table: this.getTable(),
      filters,
      dialect: this.dialect,
      searchFields: this.searchFields,
      softDeleteConfig: this.getSoftDeleteConfig(),
      defaultPerPage: this.defaultPerPage,
      cursorField: this.isCursorPaginationActive() ? this.cursorField || 'id' : undefined,
    });

    const includeOptions: IncludeOptions = {
      relations: filters.options.include || [],
      // Scope included related rows to the caller (owner-scope + soft-delete),
      // honoring `?withDeleted` for the related soft-delete filter.
      scope: this.getRelationScope(filters.options.withDeleted),
    };

    // Keyset cursor page: trim the has-more sentinel row before loading
    // relations, then return the canonical cursor-mode envelope.
    if (queryResult.cursor) {
      const { items, result_info } = buildCursorPage({
        rows: queryResult.records,
        limit: queryResult.cursor.limit,
        totalCount: queryResult.totalCount,
        cursorField: this.cursorField || 'id',
        cursorApplied: queryResult.cursor.applied,
      });
      const itemsWithRelations = await batchLoadDrizzleRelations(
        this.getDb(),
        items,
        this._meta,
        includeOptions,
      );
      return { result: itemsWithRelations, result_info };
    }

    // Load relations if requested using batch loading to avoid N+1 queries
    const itemsWithRelations = await batchLoadDrizzleRelations(
      this.getDb(),
      queryResult.records,
      this._meta,
      includeOptions,
    );

    return buildPaginatedResult(itemsWithRelations, queryResult);
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends RestoreEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /**
   * Whether to wrap restore operation in a transaction.
   * Useful when combined with hooks that perform additional operations.
   * @default false
   */
  protected useTransaction = false;

  /** Current transaction context (set during transaction execution) */
  protected declare _tx?: DrizzleDatabaseConstraint;

  /** Gets the database instance from property, transaction, or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown,
  ): Promise<ModelObject<M['model']> | null> {
    const db = tx ?? this.getDb();
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: DrizzleSql[] = [eq(lookupColumn, lookupValue)];

    // Add additional filters
    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    // Only restore records that are actually deleted
    conditions.push(isNotNull(this.getColumn(softDeleteConfig.field)));

    // Set deletedAt to null to restore the record
    const result = await cast<ModelObject<M['model']>>(db)
      .update(table)
      .set({ [softDeleteConfig.field]: null } as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    return result[0] || null;
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return cast(this.getDb()).transaction(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }
}
