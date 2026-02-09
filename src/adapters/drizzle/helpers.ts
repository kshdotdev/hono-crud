import { eq, and, or, ne, gt, gte, lt, lte, like, ilike, inArray, notInArray, isNull, isNotNull, between, sql, getTableColumns } from 'drizzle-orm';
import type { SQL, Table, Column } from 'drizzle-orm';
import type {
  MetaInput,
  FilterCondition,
  IncludeOptions,
  RelationConfig,
} from '../../core/types';

// ============================================================================
// Drizzle Database Types
// ============================================================================

/**
 * Internal query builder interface used for type-safe method calls.
 * All Drizzle query builders satisfy this interface at runtime.
 */
export interface QueryBuilder extends PromiseLike<unknown[]> {
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
export interface Database {
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
export function cast<T>(instance: T): Database {
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
export function getTable<M extends MetaInput>(meta: M): Table {
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
export function getColumn(table: Table, field: string): Column {
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
export async function loadDrizzleRelation<T extends Record<string, unknown>>(
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
export async function loadDrizzleRelations<T extends Record<string, unknown>, M extends MetaInput>(
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
export async function batchLoadDrizzleRelations<T extends Record<string, unknown>, M extends MetaInput>(
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
export function buildWhereCondition(
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
