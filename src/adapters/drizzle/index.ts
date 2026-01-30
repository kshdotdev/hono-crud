import type { Env } from 'hono';

// Re-export drizzle-zod schema utilities
export {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
  createDrizzleSchemas,
  createDrizzleSchemasAsync,
  isDrizzleZodAvailable,
} from './schema-utils';
export type { DrizzleSchemas } from './schema-utils';
import { eq, and, or, ne, gt, gte, lt, lte, like, ilike, inArray, notInArray, isNull, isNotNull, between, asc, desc, sql, getTableColumns } from 'drizzle-orm';
import type { SQL, Table, Column, InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { CreateEndpoint } from '../../endpoints/create';
import { ReadEndpoint } from '../../endpoints/read';
import { UpdateEndpoint } from '../../endpoints/update';
import { DeleteEndpoint } from '../../endpoints/delete';
import { ListEndpoint } from '../../endpoints/list';
import { RestoreEndpoint } from '../../endpoints/restore';
import { UpsertEndpoint } from '../../endpoints/upsert';
import { BatchCreateEndpoint } from '../../endpoints/batch-create';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore';
import { BatchUpsertEndpoint } from '../../endpoints/batch-upsert';
import {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from '../../endpoints/version-history';
import { AggregateEndpoint, computeAggregations } from '../../endpoints/aggregate';
import { SearchEndpoint, searchInMemory } from '../../endpoints/search';
import { ExportEndpoint } from '../../endpoints/export';
import { ImportEndpoint } from '../../endpoints/import';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  FilterCondition,
  IncludeOptions,
  RelationConfig,
  RelationsConfig,
  NestedUpdateInput,
  NestedWriteResult,
  AggregateOptions,
  AggregateResult,
  SearchOptions,
  SearchResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';

// ============================================================================
// Drizzle Database Types
// ============================================================================

/**
 * Internal query builder interface used for type-safe method calls.
 * All Drizzle query builders satisfy this interface at runtime.
 */
interface QueryBuilder extends PromiseLike<unknown[]> {
  where(condition: unknown): QueryBuilder;
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;
  orderBy(...columns: unknown[]): QueryBuilder;
  set(data: Record<string, unknown>): QueryBuilder;
  values(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder;
  returning(): QueryBuilder;
  onConflictDoUpdate(config: { target: unknown[]; set: Record<string, unknown>; where?: unknown }): QueryBuilder;
  onConflictDoNothing(config?: { target?: unknown[] }): QueryBuilder;
  onDuplicateKeyUpdate(config: { set: Record<string, unknown> }): QueryBuilder;
}

/**
 * Internal database interface used for type-safe method calls.
 * All Drizzle databases (PostgreSQL, MySQL, SQLite) satisfy this interface at runtime.
 */
interface Database {
  select(fields?: Record<string, unknown>): { from(table: Table): QueryBuilder };
  insert(table: Table): QueryBuilder;
  update(table: Table): QueryBuilder;
  delete(table: Table): QueryBuilder;
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
}

/**
 * Casts a database to the internal Database interface for method calls.
 * This is safe because all Drizzle databases have these methods at runtime.
 */
function cast<T>(instance: T): Database {
  return instance as unknown as Database;
}

/**
 * Base constraint for Drizzle database types.
 * Your database type must have select, insert, update, delete, and transaction methods.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/postgres-js';
 * import * as schema from './schema';
 *
 * const database = drizzle(client, { schema });
 *
 * // Pass typeof database as the DB generic parameter
 * class UserCreate extends DrizzleCreateEndpoint<Env, UserMeta, typeof database> {
 *   db = database;  // Full type safety!
 * }
 * ```
 */
export interface DrizzleDatabaseConstraint {
  select: unknown;
  insert: unknown;
  update: unknown;
  delete: unknown;
  transaction: unknown;
}

/**
 * @deprecated Pass your database type as a generic parameter instead
 */
export type DrizzleDatabase = DrizzleDatabaseConstraint;

/**
 * @deprecated Pass your database type as a generic parameter instead
 */
export type DrizzleDB = DrizzleDatabaseConstraint;

/**
 * Type helper for defining Hono Env with database in Variables.
 * Use this when injecting the database via middleware.
 *
 * @example
 * ```ts
 * import { DrizzleEnv } from 'hono-crud/adapters/drizzle';
 *
 * type AppEnv = DrizzleEnv<typeof db>;
 *
 * const app = new Hono<AppEnv>();
 *
 * app.use('*', async (c, next) => {
 *   c.set('db', db);
 *   await next();
 * });
 *
 * // Endpoints can now access db from context automatically
 * class ProjectCreate extends DrizzleCreateEndpoint<AppEnv, typeof projectMeta> {
 *   _meta = projectMeta;
 *   // No db property needed - comes from context!
 * }
 * ```
 */
export type DrizzleEnv<DB = DrizzleDatabaseConstraint> = {
  Variables: {
    db: DB;
  };
};

/**
 * Gets the Drizzle table from the model.
 */
function getTable<M extends MetaInput>(meta: M): Table {
  if (!meta.model.table) {
    throw new Error(`Model ${meta.model.tableName} does not have a table reference`);
  }
  return meta.model.table as Table;
}

/**
 * Gets a column from the table with proper type safety.
 * Uses drizzle-orm's getTableColumns for type-safe column access.
 *
 * @param table - The Drizzle table
 * @param field - The field/column name
 * @returns The column
 * @throws Error if the column is not found in the table
 */
function getColumn(table: Table, field: string): Column {
  const columns = getTableColumns(table);
  const column = columns[field];
  if (!column) {
    throw new Error(
      `Column '${field}' not found in table. ` +
      `Available columns: ${Object.keys(columns).join(', ')}`
    );
  }
  return column as Column;
}

/**
 * Loads related records for a given item using Drizzle queries.
 */
async function loadDrizzleRelation<T extends Record<string, unknown>>(
  db: DrizzleDatabase,
  item: T,
  relationName: string,
  relationConfig: RelationConfig<Table>
): Promise<T> {
  if (!relationConfig.table) {
    // Can't load relation without table reference
    return item;
  }

  const relatedTable = relationConfig.table;

  switch (relationConfig.type) {
    case 'hasOne': {
      const localKey = relationConfig.localKey || 'id';
      const localValue = item[localKey];
      if (localValue === undefined || localValue === null) {
        return item;
      }
      const foreignKeyColumn = getColumn(relatedTable, relationConfig.foreignKey);
      const results = await cast(db)
        .select()
        .from(relatedTable)
        .where(eq(foreignKeyColumn, localValue))
        .limit(1);
      return { ...item, [relationName]: results[0] || null };
    }
    case 'hasMany': {
      const localKey = relationConfig.localKey || 'id';
      const localValue = item[localKey];
      if (localValue === undefined || localValue === null) {
        return { ...item, [relationName]: [] };
      }
      const foreignKeyColumn = getColumn(relatedTable, relationConfig.foreignKey);
      const results = await cast(db)
        .select()
        .from(relatedTable)
        .where(eq(foreignKeyColumn, localValue));
      return { ...item, [relationName]: results };
    }
    case 'belongsTo': {
      // For belongsTo, the foreign key is on the current item
      const foreignValue = item[relationConfig.foreignKey];
      if (foreignValue === undefined || foreignValue === null) {
        return { ...item, [relationName]: null };
      }
      const localKeyColumn = getColumn(relatedTable, relationConfig.localKey || 'id');
      const results = await cast(db)
        .select()
        .from(relatedTable)
        .where(eq(localKeyColumn, foreignValue))
        .limit(1);
      return { ...item, [relationName]: results[0] || null };
    }
    default:
      return item;
  }
}

/**
 * Loads all requested relations for an item.
 * Note: For multiple items, use `batchLoadDrizzleRelations` to avoid N+1 queries.
 */
async function loadDrizzleRelations<T extends Record<string, unknown>, M extends MetaInput>(
  db: DrizzleDatabase,
  item: T,
  meta: M,
  includeOptions?: IncludeOptions
): Promise<T> {
  if (!includeOptions?.relations?.length || !meta.model.relations) {
    return item;
  }

  let result = { ...item } as T;

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName] as RelationConfig<Table> | undefined;
    if (relationConfig) {
      result = await loadDrizzleRelation(db, result, relationName, relationConfig);
    }
  }

  return result;
}

/**
 * Batch loads relations for multiple items to avoid N+1 queries.
 * Instead of N queries per relation, this uses 1 query per relation using inArray().
 */
async function batchLoadDrizzleRelations<T extends Record<string, unknown>, M extends MetaInput>(
  db: DrizzleDatabase,
  items: T[],
  meta: M,
  includeOptions?: IncludeOptions
): Promise<T[]> {
  if (!items.length || !includeOptions?.relations?.length || !meta.model.relations) {
    return items;
  }

  // Clone all items to avoid mutation
  let results = items.map(item => ({ ...item })) as T[];

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName] as RelationConfig<Table> | undefined;
    if (!relationConfig || !relationConfig.table) {
      continue;
    }

    const relatedTable = relationConfig.table;

    switch (relationConfig.type) {
      case 'hasOne':
      case 'hasMany': {
        const localKey = relationConfig.localKey || 'id';

        // Collect all unique local values
        const localValues = [...new Set(
          results
            .map(item => item[localKey])
            .filter(val => val !== undefined && val !== null)
        )];

        if (localValues.length === 0) {
          // Set empty results for all items
          results = results.map(item => ({
            ...item,
            [relationName]: relationConfig.type === 'hasMany' ? [] : null,
          }));
          continue;
        }

        // Batch query: Load all related records in a single query
        const foreignKeyColumn = getColumn(relatedTable, relationConfig.foreignKey);
        const relatedRecords = await cast(db)
          .select()
          .from(relatedTable)
          .where(inArray(foreignKeyColumn, localValues));

        // Group related records by foreign key
        const recordsByForeignKey = new Map<unknown, Record<string, unknown>[]>();
        for (const record of relatedRecords) {
          const foreignVal = (record as Record<string, unknown>)[relationConfig.foreignKey];
          if (!recordsByForeignKey.has(foreignVal)) {
            recordsByForeignKey.set(foreignVal, []);
          }
          recordsByForeignKey.get(foreignVal)!.push(record as Record<string, unknown>);
        }

        // Map results back to items
        results = results.map(item => {
          const localValue = item[localKey];
          const related = recordsByForeignKey.get(localValue) || [];
          return {
            ...item,
            [relationName]: relationConfig.type === 'hasMany' ? related : (related[0] || null),
          };
        });
        break;
      }

      case 'belongsTo': {
        // For belongsTo, the foreign key is on the current item
        const refLocalKey = relationConfig.localKey || 'id';

        // Collect all unique foreign key values
        const foreignValues = [...new Set(
          results
            .map(item => item[relationConfig.foreignKey])
            .filter(val => val !== undefined && val !== null)
        )];

        if (foreignValues.length === 0) {
          // Set null for all items
          results = results.map(item => ({
            ...item,
            [relationName]: null,
          }));
          continue;
        }

        // Batch query: Load all parent records in a single query
        const localKeyColumn = getColumn(relatedTable, refLocalKey);
        const relatedRecords = await cast(db)
          .select()
          .from(relatedTable)
          .where(inArray(localKeyColumn, foreignValues));

        // Create a map for quick lookup
        const recordsByLocalKey = new Map<unknown, Record<string, unknown>>();
        for (const record of relatedRecords) {
          const localVal = (record as Record<string, unknown>)[refLocalKey];
          recordsByLocalKey.set(localVal, record as Record<string, unknown>);
        }

        // Map results back to items
        results = results.map(item => {
          const foreignValue = item[relationConfig.foreignKey];
          return {
            ...item,
            [relationName]: recordsByLocalKey.get(foreignValue) || null,
          };
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Builds a where condition from filter conditions.
 */
function buildWhereCondition(
  table: Table,
  filter: FilterCondition
): SQL | undefined {
  const column = getColumn(table, filter.field);

  switch (filter.operator) {
    case 'eq':
      return eq(column, filter.value);
    case 'ne':
      return ne(column, filter.value);
    case 'gt':
      return gt(column, filter.value);
    case 'gte':
      return gte(column, filter.value);
    case 'lt':
      return lt(column, filter.value);
    case 'lte':
      return lte(column, filter.value);
    case 'in':
      return inArray(column, filter.value as unknown[]);
    case 'nin':
      return notInArray(column, filter.value as unknown[]);
    case 'like':
      return like(column, filter.value as string);
    case 'ilike':
      return ilike(column, filter.value as string);
    case 'null':
      return filter.value ? isNull(column) : isNotNull(column);
    case 'between': {
      const [min, max] = filter.value as [unknown, unknown];
      return between(column, min, max);
    }
    default:
      return undefined;
  }
}

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
      console.warn(
        `Related table not found for ${relationName}. Add 'table' to the relation config.`
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
      console.warn(
        `Related table not found for ${relationName}. Add 'table' to the relation config.`
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

/**
 * Drizzle Batch Create endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 */
export abstract class DrizzleBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchCreateEndpoint<E, M> {
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

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate IDs for items that don't have them
    const records = items.map((item) => ({
      ...item,
      [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    }));

    const result = await cast(this.db)
      .insert(table)
      .values(records)
      .returning();

    return result as ModelObject<M['model']>[];
  }
}

/**
 * Drizzle Batch Update endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete filtering (cannot update deleted records).
 */
export abstract class DrizzleBatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpdateEndpoint<E, M> {
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

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Process each update individually (Drizzle doesn't have bulk update with different values)
    for (const item of items) {
      const conditions: SQL[] = [eq(lookupColumn, item.id)];

      // Filter out soft-deleted records
      if (softDeleteConfig.enabled) {
        conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
      }

      const result = await cast(this.db)
        .update(table)
        .set(item.data as Record<string, unknown>)
        .where(and(...conditions))
        .returning();

      if (result[0]) {
        updated.push(result[0] as ModelObject<M['model']>);
      } else {
        notFound.push(item.id);
      }
    }

    return { updated, notFound };
  }
}

/**
 * Drizzle Batch Delete endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete when the model has `softDelete` configured.
 */
export abstract class DrizzleBatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchDeleteEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition for all IDs
    const conditions: SQL[] = [inArray(lookupColumn, ids)];

    // For soft delete, exclude already-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    let result: unknown[];

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      result = await cast(this.getDb())
        .update(table)
        .set({ [softDeleteConfig.field]: new Date() } as Record<string, unknown>)
        .where(and(...conditions))
        .returning();
    } else {
      // Hard delete: actually remove the records
      result = await cast(this.getDb())
        .delete(table)
        .where(and(...conditions))
        .returning();
    }

    const deleted = result as ModelObject<M['model']>[];
    const deletedIds = new Set(deleted.map((item) => String((item as Record<string, unknown>)[this.lookupField])));
    const notFound = ids.filter((id) => !deletedIds.has(id));

    return { deleted, notFound };
  }
}

/**
 * Drizzle Batch Restore endpoint for un-deleting soft-deleted records.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Only works with models that have `softDelete` enabled.
 */
export abstract class DrizzleBatchRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchRestoreEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition: IDs that are actually deleted
    const conditions: SQL[] = [
      inArray(lookupColumn, ids),
      isNotNull(this.getColumn(softDeleteConfig.field)),
    ];

    // Set deletedAt to null to restore the records
    const result = await cast(this.getDb())
      .update(table)
      .set({ [softDeleteConfig.field]: null } as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    const restored = result as ModelObject<M['model']>[];
    const restoredIds = new Set(restored.map((item) => String((item as Record<string, unknown>)[this.lookupField])));
    const notFound = ids.filter((id) => !restoredIds.has(id));

    return { restored, notFound };
  }
}

/**
 * Drizzle Upsert endpoint.
 * Creates a record if it doesn't exist, updates it if it does.
 */
export abstract class DrizzleUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpsertEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const conditions: SQL[] = [];

    // Build conditions from upsert keys
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(eq(this.getColumn(key), value));
      }
    }

    // Soft delete filter
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    if (conditions.length === 0) {
      return null;
    }

    const result = await cast(this.getDb())
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return (result[0] as ModelObject<M['model']>) || null;
  }

  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(data as Record<string, unknown>)
      .where(eq(this.getColumn(pk), pkValue))
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  /**
   * Performs a native database upsert using ON CONFLICT DO UPDATE (PostgreSQL/SQLite)
   * or ON DUPLICATE KEY UPDATE (MySQL).
   *
   * Note: This method cannot accurately determine if the record was created or updated.
   * The `created` flag is set to `false` by default. If you need accurate create/update
   * tracking, use the standard upsert pattern (useNativeUpsert = false).
   */
  protected override async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    // Build the set clause for update - exclude upsert keys and primary key
    const updateSet: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!upsertKeys.includes(key) && key !== primaryKey) {
        // Filter out create-only fields for update
        if (!this.createOnlyFields?.includes(key)) {
          updateSet[key] = value;
        }
      }
    }

    // Get the target columns for conflict detection
    const targetColumns = upsertKeys.map((key) => this.getColumn(key));

    // Build condition for soft delete - only update non-deleted records
    let whereCondition: SQL | undefined;
    if (softDeleteConfig.enabled) {
      whereCondition = isNull(this.getColumn(softDeleteConfig.field));
    }

    try {
      // Try PostgreSQL/SQLite style: onConflictDoUpdate
      const insertQuery = cast(this.getDb()).insert(table).values(record as Record<string, unknown>);

      // Use onConflictDoUpdate for PostgreSQL/SQLite
      const result = await insertQuery
        .onConflictDoUpdate({
          target: targetColumns,
          set: Object.keys(updateSet).length > 0 ? updateSet : { [primaryKey]: sql`${this.getColumn(primaryKey)}` },
          where: whereCondition,
        })
        .returning();

      return {
        data: result[0] as ModelObject<M['model']>,
        created: false, // We can't accurately determine this with native upsert
      };
    } catch (error) {
      // If onConflictDoUpdate fails, try MySQL style: onDuplicateKeyUpdate
      if (error instanceof Error && error.message.includes('onConflictDoUpdate')) {
        try {
          const insertQuery = cast(this.getDb()).insert(table).values(record as Record<string, unknown>);
          const result = await insertQuery
            .onDuplicateKeyUpdate({
              set: Object.keys(updateSet).length > 0 ? updateSet : { [primaryKey]: sql`${this.getColumn(primaryKey)}` },
            })
            .returning();

          return {
            data: result[0] as ModelObject<M['model']>,
            created: false,
          };
        } catch {
          // Fall back to standard upsert if native fails
          return this.performStandardUpsert(data, tx);
        }
      }
      throw error;
    }
  }
}

/**
 * Drizzle Batch Upsert endpoint.
 */
export abstract class DrizzleBatchUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpsertEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const conditions: SQL[] = [];

    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(eq(this.getColumn(key), value));
      }
    }

    if (conditions.length === 0) {
      return null;
    }

    const result = await cast(this.getDb())
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return (result[0] as ModelObject<M['model']>) || null;
  }

  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(data as Record<string, unknown>)
      .where(eq(this.getColumn(pk), pkValue))
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  /**
   * Performs a native database batch upsert using ON CONFLICT DO UPDATE (PostgreSQL/SQLite)
   * or ON DUPLICATE KEY UPDATE (MySQL).
   *
   * Note: This method cannot accurately determine which records were created vs updated.
   * All records are marked as `created: false`. If you need accurate tracking,
   * use the standard batch upsert pattern (useNativeUpsert = false).
   */
  protected override async nativeBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<{
    items: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }>;
    createdCount: number;
    updatedCount: number;
    totalCount: number;
    errors?: Array<{ index: number; error: string }>;
  }> {
    if (items.length === 0) {
      return {
        items: [],
        createdCount: 0,
        updatedCount: 0,
        totalCount: 0,
      };
    }

    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Prepare all records with generated UUIDs
    const records = items.map((item) => ({
      ...item,
      [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    }));

    // Build the set clause for update - exclude upsert keys and primary key
    // Use the first item as template for update fields
    const updateSet: Record<string, unknown> = {};
    const firstItem = items[0];
    for (const key of Object.keys(firstItem as Record<string, unknown>)) {
      if (!upsertKeys.includes(key) && key !== primaryKey) {
        // Filter out create-only fields for update
        if (!this.createOnlyFields?.includes(key)) {
          // Use sql placeholder to reference the excluded row
          updateSet[key] = sql`excluded.${sql.identifier(key)}`;
        }
      }
    }

    // Get the target columns for conflict detection
    const targetColumns = upsertKeys.map((key) => this.getColumn(key));

    try {
      // PostgreSQL/SQLite style: onConflictDoUpdate with batch insert
      const insertQuery = cast(this.getDb()).insert(table).values(records as Record<string, unknown>[]);

      const result = await insertQuery
        .onConflictDoUpdate({
          target: targetColumns,
          set: Object.keys(updateSet).length > 0 ? updateSet : { [primaryKey]: sql`${this.getColumn(primaryKey)}` },
        })
        .returning();

      return {
        items: result.map((data: unknown, index: number) => ({
          data: data as ModelObject<M['model']>,
          created: false, // Cannot determine with native upsert
          index,
        })),
        createdCount: 0, // Cannot determine with native upsert
        updatedCount: result.length, // Assume all were updates (conservative)
        totalCount: result.length,
      };
    } catch (error) {
      // If onConflictDoUpdate fails, try MySQL style: onDuplicateKeyUpdate
      if (error instanceof Error && error.message.includes('onConflictDoUpdate')) {
        try {
          const insertQuery = cast(this.getDb()).insert(table).values(records as Record<string, unknown>[]);
          const result = await insertQuery
            .onDuplicateKeyUpdate({
              set: Object.keys(updateSet).length > 0 ? updateSet : { [primaryKey]: sql`${this.getColumn(primaryKey)}` },
            })
            .returning();

          return {
            items: result.map((data: unknown, index: number) => ({
              data: data as ModelObject<M['model']>,
              created: false,
              index,
            })),
            createdCount: 0,
            updatedCount: result.length,
            totalCount: result.length,
          };
        } catch {
          // Fall back to standard batch upsert if native fails
          return this.performStandardBatchUpsert(items, tx);
        }
      }
      throw error;
    }
  }
}

/**
 * Drizzle Version History endpoint.
 * Lists all versions for a record.
 */
export abstract class DrizzleVersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionHistoryEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  protected override async recordExists(lookupValue: string): Promise<boolean> {
    const table = this.getTable();

    const result = await cast(this.getDb())
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(eq(this.getColumn('id'), lookupValue));

    return Number((result as { count: number }[])[0]?.count) > 0;
  }
}

/**
 * Drizzle Version Read endpoint.
 * Gets a specific version of a record.
 */
export abstract class DrizzleVersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionReadEndpoint<E, M> {}

/**
 * Drizzle Version Compare endpoint.
 * Compares two versions of a record.
 */
export abstract class DrizzleVersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionCompareEndpoint<E, M> {}

/**
 * Drizzle Version Rollback endpoint.
 * Rolls back a record to a previous version.
 */
export abstract class DrizzleVersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionRollbackEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const versionField = this.getVersioningConfig().field;

    const result = await cast(this.getDb())
      .update(table)
      .set({
        ...versionData,
        [versionField]: newVersion,
      } as Record<string, unknown>)
      .where(eq(this.getColumn('id'), lookupValue))
      .returning();

    return result[0] as ModelObject<M['model']>;
  }
}

/**
 * Drizzle Aggregate endpoint.
 * Computes aggregations (COUNT, SUM, AVG, MIN, MAX) with GROUP BY support.
 */
export abstract class DrizzleAggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends AggregateEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  override async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const table = this.getTable();
    const conditions: SQL[] = [];

    // Apply soft delete filter
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled) {
      const { query } = await this.getValidatedData();
      const withDeleted = query?.withDeleted === true || query?.withDeleted === 'true';

      if (!withDeleted) {
        conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
      }
    }

    // Apply filters
    if (options.filters) {
      for (const [field, value] of Object.entries(options.filters)) {
        if (typeof value === 'object' && value !== null) {
          // Operator syntax
          for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
            const condition = buildWhereCondition(table, {
              field,
              operator: op as FilterCondition['operator'],
              value: opValue,
            });
            if (condition) {
              conditions.push(condition);
            }
          }
        } else {
          // Simple equality
          conditions.push(eq(this.getColumn(field), value));
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // For complex aggregations with GROUP BY, HAVING, etc., we fetch records
    // and use the in-memory computeAggregations helper.
    // This ensures consistent behavior across all databases.
    const records = await cast(this.getDb()).select().from(table).where(whereClause);

    return computeAggregations(records as Record<string, unknown>[], options);
  }
}

/**
 * Drizzle Search endpoint.
 * Provides full-text search with relevance scoring and highlighting.
 *
 * For PostgreSQL, this can leverage native tsvector/tsquery for better performance.
 * For SQLite/MySQL, it falls back to LIKE-based searching with in-memory scoring.
 *
 * Features:
 * - PostgreSQL: Uses to_tsvector() and plainto_tsquery() for native full-text search
 * - SQLite/MySQL: Falls back to LIKE/ILIKE with in-memory scoring
 * - Configurable field weights
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact)
 * - Highlighted snippets
 * - Combined with standard list filters
 *
 * @example
 * ```ts
 * class ArticleSearch extends DrizzleSearchEndpoint<Env, typeof articleMeta> {
 *   _meta = articleMeta;
 *   db = db;
 *   schema = { tags: ['Articles'], summary: 'Search articles' };
 *
 *   protected searchFields = ['title', 'content', 'tags'];
 *   protected fieldWeights = { title: 2.0, content: 1.0, tags: 1.5 };
 *   protected filterFields = ['status', 'categoryId'];
 * }
 * ```
 */
export abstract class DrizzleSearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  /**
   * Enable PostgreSQL native full-text search.
   * When true and vectorColumn is set, uses tsvector/tsquery.
   * When false, uses LIKE-based search with in-memory scoring.
   */
  protected useNativeSearch: boolean = false;

  /**
   * PostgreSQL tsvector column name for native full-text search.
   * If set and useNativeSearch is true, searches against this column.
   */
  protected vectorColumn?: string;

  /**
   * PostgreSQL text search configuration (e.g., 'english', 'simple').
   */
  protected vectorConfig: string = 'english';

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  /**
   * Performs search on database.
   */
  override async search(
    options: SearchOptions,
    filters: ListFilters
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const table = this.getTable();
    const conditions: SQL[] = [];

    // Apply soft delete filter
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled) {
      if (filters.options.onlyDeleted) {
        conditions.push(isNotNull(this.getColumn(softDeleteConfig.field)));
      } else if (!filters.options.withDeleted) {
        conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
      }
    }

    // Apply filters
    for (const filter of filters.filters) {
      const condition = buildWhereCondition(table, filter);
      if (condition) {
        conditions.push(condition);
      }
    }

    // Build search conditions
    const searchableFields = this.getSearchableFields();
    const fieldsToSearch = options.fields || Object.keys(searchableFields);

    if (this.useNativeSearch && this.vectorColumn) {
      // PostgreSQL native full-text search
      const vectorCol = this.getColumn(this.vectorColumn);
      const tsQuery = options.mode === 'phrase'
        ? sql`phraseto_tsquery(${this.vectorConfig}, ${options.query})`
        : options.mode === 'all'
          ? sql`plainto_tsquery(${this.vectorConfig}, ${options.query})`
          : sql`to_tsquery(${this.vectorConfig}, ${options.query.split(/\s+/).join(' | ')})`;

      conditions.push(sql`${vectorCol} @@ ${tsQuery}`);
    } else {
      // Fallback: LIKE-based search
      const searchConditions = fieldsToSearch.map((field) => {
        try {
          const column = this.getColumn(field);
          // Use ILIKE for case-insensitive search (works with PostgreSQL)
          // For SQLite, use LOWER() with LIKE
          return sql`LOWER(CAST(${column} AS TEXT)) LIKE LOWER(${`%${options.query}%`})`;
        } catch {
          return undefined;
        }
      }).filter((c): c is SQL => c !== undefined);

      if (searchConditions.length > 0) {
        if (options.mode === 'all') {
          // AND all conditions
          conditions.push(and(...searchConditions)!);
        } else {
          // OR conditions for 'any' mode
          conditions.push(or(...searchConditions)!);
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await cast(this.getDb())
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(whereClause);

    const totalCount = Number((countResult as { count: number }[])[0]?.count) || 0;

    // Build main query
    let query = cast(this.getDb()).select().from(table).where(whereClause);

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

    const records = await query;

    // Score results in memory and generate highlights
    const searchResults = searchInMemory(
      records as ModelObject<M['model']>[],
      options,
      searchableFields
    );

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };

    // Extract items for batch relation loading
    const items = searchResults.map(r => r.item as Record<string, unknown>);
    const itemsWithRelations = await batchLoadDrizzleRelations(
      this.getDb(),
      items,
      this._meta,
      includeOptions
    );

    // Map back the relations to the search results
    const resultsWithRelations = searchResults.map((result, index) => ({
      ...result,
      item: itemsWithRelations[index] as ModelObject<M['model']>,
    }));

    return {
      items: resultsWithRelations,
      totalCount,
    };
  }
}

/**
 * Drizzle Export endpoint.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class DrizzleExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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
        conditions.push(isNotNull(deletedAtColumn));
      } else if (!filters.options.withDeleted) {
        conditions.push(isNull(deletedAtColumn));
      }
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
        return sql`LOWER(${column}) LIKE LOWER(${`%${filters.options.search}%`})`;
      });
      conditions.push(or(...searchConditions)!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await cast(this.getDb())
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(whereClause);

    const totalCount = Number((countResult as { count: number }[])[0]?.count) || 0;

    // Build main query
    let query = cast(this.getDb()).select().from(table).where(whereClause);

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
 * Drizzle Import endpoint.
 * Imports data from CSV or JSON with support for create and upsert modes.
 */
export abstract class DrizzleImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ImportEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
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

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const conditions: SQL[] = [];

    // Build conditions from upsert keys
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(eq(this.getColumn(key), value));
      }
    }

    // Soft delete filter
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    if (conditions.length === 0) {
      return null;
    }

    const result = await cast(this.getDb())
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return (result[0] as ModelObject<M['model']>) || null;
  }

  /**
   * Creates a new record.
   */
  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(data as Record<string, unknown>)
      .where(eq(this.getColumn(pk), pkValue))
      .returning();

    return result[0] as ModelObject<M['model']>;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Return type of createDrizzleCrud factory function.
 * Provides type-safe base classes for all CRUD operations.
 */
export interface DrizzleCrudClasses<M extends MetaInput> {
  Create: typeof DrizzleCreateEndpoint<Env, M>;
  Read: typeof DrizzleReadEndpoint<Env, M>;
  Update: typeof DrizzleUpdateEndpoint<Env, M>;
  Delete: typeof DrizzleDeleteEndpoint<Env, M>;
  List: typeof DrizzleListEndpoint<Env, M>;
  Restore: typeof DrizzleRestoreEndpoint<Env, M>;
  Upsert: typeof DrizzleUpsertEndpoint<Env, M>;
  BatchCreate: typeof DrizzleBatchCreateEndpoint<Env, M>;
  BatchUpdate: typeof DrizzleBatchUpdateEndpoint<Env, M>;
  BatchDelete: typeof DrizzleBatchDeleteEndpoint<Env, M>;
  BatchRestore: typeof DrizzleBatchRestoreEndpoint<Env, M>;
  BatchUpsert: typeof DrizzleBatchUpsertEndpoint<Env, M>;
}

/**
 * Creates a set of Drizzle CRUD endpoint base classes with db and meta pre-configured.
 * This is the cleanest pattern - no need to set `_meta` or `db` in your classes.
 *
 * @param db - Your Drizzle database instance
 * @param meta - The meta object (from defineMeta)
 * @returns Object with Create, Read, Update, Delete, List base classes
 *
 * @example
 * ```ts
 * import { createDrizzleCrud } from 'hono-crud/adapters/drizzle';
 *
 * const projectMeta = defineMeta({ model: ProjectModel, fields: projectSchemas.insert });
 * const Project = createDrizzleCrud(db, projectMeta);
 *
 * // Now define endpoints with minimal boilerplate:
 * class ProjectCreate extends Project.Create {
 *   schema = { tags: ["Projects"], summary: "Create a new project" };
 * }
 *
 * class ProjectList extends Project.List {
 *   schema = { tags: ["Projects"], summary: "List all projects" };
 *   protected searchFields = ["name", "clientName"];
 *   protected filterFields = ["status"];
 * }
 * ```
 */
export function createDrizzleCrud<M extends MetaInput>(
  db: DrizzleDatabaseConstraint,
  meta: M
): DrizzleCrudClasses<M> {
  // Use type assertion to avoid TypeScript's anonymous class protected member restriction
  return {
    Create: class extends DrizzleCreateEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    Read: class extends DrizzleReadEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    Update: class extends DrizzleUpdateEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    Delete: class extends DrizzleDeleteEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    List: class extends DrizzleListEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    Restore: class extends DrizzleRestoreEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    Upsert: class extends DrizzleUpsertEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    BatchCreate: class extends DrizzleBatchCreateEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    BatchUpdate: class extends DrizzleBatchUpdateEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    BatchDelete: class extends DrizzleBatchDeleteEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    BatchRestore: class extends DrizzleBatchRestoreEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
    BatchUpsert: class extends DrizzleBatchUpsertEndpoint<Env, M> {
      _meta = meta;
      db = db;
    },
  } as DrizzleCrudClasses<M>;
}

// ============================================================================
// Drizzle Adapters Bundle (for Config-based API)
// ============================================================================

import type { AdapterBundle } from '../../config/index';

/**
 * Drizzle adapter bundle for use with defineEndpoints.
 *
 * Note: When using DrizzleAdapters with defineEndpoints, you need to provide
 * your own base classes that extend the Drizzle endpoint classes and include
 * the `db` property. The config-based API cannot inject the database instance.
 *
 * @example
 * ```ts
 * import { defineEndpoints } from 'hono-crud';
 * import { DrizzleAdapters } from 'hono-crud/adapters/drizzle';
 *
 * // Create custom adapters with db injected
 * const MyDrizzleAdapters = {
 *   CreateEndpoint: class extends DrizzleCreateEndpoint { db = myDb; },
 *   ListEndpoint: class extends DrizzleListEndpoint { db = myDb; },
 *   ReadEndpoint: class extends DrizzleReadEndpoint { db = myDb; },
 *   UpdateEndpoint: class extends DrizzleUpdateEndpoint { db = myDb; },
 *   DeleteEndpoint: class extends DrizzleDeleteEndpoint { db = myDb; },
 * };
 *
 * const userEndpoints = defineEndpoints({ meta: userMeta, ... }, MyDrizzleAdapters);
 * ```
 */
export const DrizzleAdapters: AdapterBundle = {
  CreateEndpoint: DrizzleCreateEndpoint,
  ListEndpoint: DrizzleListEndpoint,
  ReadEndpoint: DrizzleReadEndpoint,
  UpdateEndpoint: DrizzleUpdateEndpoint,
  DeleteEndpoint: DrizzleDeleteEndpoint,
};
