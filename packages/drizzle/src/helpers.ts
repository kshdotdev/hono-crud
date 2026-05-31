import {
  and as _and,
  or as _or,
  between,
  eq,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInArray,
} from 'drizzle-orm';
import type {
  FilterCondition,
  IncludeOptions,
  MetaInput,
  RelationConfig,
} from 'hono-crud/internal';
import { assertNever } from 'hono-crud/internal';

// ============================================================================
// Local stand-ins for drizzle-orm builder types
// ============================================================================
//
// The adapter's public surface must never name a versioned `drizzle-orm` type
// (Table/Column/SQL), so the API stays decoupled from the ORM version. These
// local structural types model just enough shape to flow through the adapter;
// the real drizzle values satisfy them at runtime, and the few internal call
// sites that hand them back to drizzle's value-imported operators launder
// through `unknown` in their bodies (never in an exported signature).

/**
 * Local stand-in for a drizzle-orm `Table`. Real drizzle tables (and any
 * duck-typed table carrying `_.name`/`_.columns`) satisfy this shape. Shared
 * with `schema-utils.ts`.
 */
export interface DrizzleTable {
  _: { name: string; columns: Record<string, unknown> };
}

/**
 * Local stand-in for a drizzle-orm `Column`.
 *
 * Declares `getSQL()` so a column value is structurally a drizzle `SQLWrapper`,
 * which every operator (`eq`, `isNull`, `inArray`, `asc`, ...) accepts — so
 * columns pass straight into operators with no cast at the call site. The
 * `never` return keeps it opaque.
 */
export interface DrizzleColumn {
  getSQL(): never;
}

/**
 * Local stand-in for a drizzle-orm `SQL` expression. A supertype of the real
 * `SQL`, so operator results widen into it for free; the {@link and}/{@link or}
 * helpers below let condition arrays round-trip without naming a drizzle type.
 */
export interface DrizzleSql {
  getSQL(): unknown;
}

// ============================================================================
// Drizzle Database Types
// ============================================================================

/**
 * Internal query builder interface used for type-safe method calls, generic
 * over the resolved row type `Row`. All Drizzle query builders satisfy this
 * interface at runtime; awaiting one resolves to `Row[]`.
 */
export interface QueryBuilder<Row = unknown> extends PromiseLike<Row[]> {
  where(condition: unknown): QueryBuilder<Row>;
  limit(n: number): QueryBuilder<Row>;
  offset(n: number): QueryBuilder<Row>;
  orderBy(...columns: unknown[]): QueryBuilder<Row>;
  set(data: Record<string, unknown>): QueryBuilder<Row>;
  values(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<Row>;
  returning(): QueryBuilder<Row>;
  onConflictDoUpdate(config: {
    target: unknown[];
    set: Record<string, unknown>;
    where?: unknown;
  }): QueryBuilder<Row>;
  onConflictDoNothing(config?: { target?: unknown[] }): QueryBuilder<Row>;
  onDuplicateKeyUpdate(config: { set: Record<string, unknown> }): QueryBuilder<Row>;
}

/**
 * Internal database interface used for type-safe method calls, generic over the
 * resolved row type `Row`. All Drizzle databases (PostgreSQL, MySQL, SQLite)
 * satisfy this interface at runtime.
 */
export interface Database<Row = unknown> {
  select(fields?: Record<string, unknown>): { from(table: DrizzleTable): QueryBuilder<Row> };
  insert(table: DrizzleTable): QueryBuilder<Row>;
  update(table: DrizzleTable): QueryBuilder<Row>;
  delete(table: DrizzleTable): QueryBuilder<Row>;
  transaction<T>(fn: (tx: Database<Row>) => Promise<T>): Promise<T>;
}

/**
 * Casts a database handle to the internal {@link Database} interface for method
 * calls, parametrized over the row type `Row` that queries resolve to. This is
 * the single sanctioned boundary `as`: all Drizzle databases expose these
 * methods at runtime, and the row type derives from the consumer's Zod schema
 * (`ModelObject<M['model']>`), never from a drizzle-orm type.
 */
export function cast<Row = unknown>(instance: unknown): Database<Row> {
  return instance as Database<Row>;
}

/**
 * Combine conditions with SQL `AND`. Thin wrapper over drizzle's `and` that
 * speaks the adapter's local {@link DrizzleSql} type so callers never name a
 * drizzle-orm type. `undefined` entries are ignored (drizzle's behavior); the
 * result is `undefined` when no conditions are supplied.
 */
export function and(...conditions: (DrizzleSql | undefined)[]): DrizzleSql | undefined {
  return _and(...(conditions as unknown as Parameters<typeof _and>));
}

/**
 * Combine conditions with SQL `OR`. See {@link and}.
 */
export function or(...conditions: (DrizzleSql | undefined)[]): DrizzleSql | undefined {
  return _or(...(conditions as unknown as Parameters<typeof _or>));
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
 * Drizzle SQL dialect identifier used to branch dialect-specific behavior
 * (e.g. native upsert syntax: `ON CONFLICT DO UPDATE` for sqlite/pg vs
 * `ON DUPLICATE KEY UPDATE` for mysql).
 *
 * The default for {@link createDrizzleCrud} is `'sqlite'` (preserves
 * pre-existing portable behavior). Set explicitly when targeting PostgreSQL
 * or MySQL to enable the appropriate code paths.
 */
export const DRIZZLE_DIALECTS = ['sqlite', 'pg', 'mysql'] as const;
export type DrizzleDialect = (typeof DRIZZLE_DIALECTS)[number];

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
export function getTable<M extends MetaInput>(meta: M): DrizzleTable {
  if (!meta.model.table) {
    throw new Error(`Model ${meta.model.tableName} does not have a table reference`);
  }
  return meta.model.table as DrizzleTable;
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
export function getColumn(table: DrizzleTable, field: string): DrizzleColumn {
  const columns = getTableColumns(table as unknown as Parameters<typeof getTableColumns>[0]);
  const column = columns[field];
  if (!column) {
    throw new Error(
      `Column '${field}' not found in table. ` +
        `Available columns: ${Object.keys(columns).join(', ')}`,
    );
  }
  return column as unknown as DrizzleColumn;
}

/**
 * Loads related records for a given item using Drizzle queries.
 */
export async function loadDrizzleRelation<T extends Record<string, unknown>>(
  db: DrizzleDatabaseConstraint,
  item: T,
  relationName: string,
  relationConfig: RelationConfig<DrizzleTable>,
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
  db: DrizzleDatabaseConstraint,
  item: T,
  meta: M,
  includeOptions?: IncludeOptions,
): Promise<T> {
  if (!includeOptions?.relations?.length || !meta.model.relations) {
    return item;
  }

  let result = { ...item } as T;

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName] as
      | RelationConfig<DrizzleTable>
      | undefined;
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
export async function batchLoadDrizzleRelations<
  T extends Record<string, unknown>,
  M extends MetaInput,
>(
  db: DrizzleDatabaseConstraint,
  items: T[],
  meta: M,
  includeOptions?: IncludeOptions,
): Promise<T[]> {
  if (!items.length || !includeOptions?.relations?.length || !meta.model.relations) {
    return items;
  }

  // Clone all items to avoid mutation
  let results = items.map((item) => ({ ...item })) as T[];

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName] as
      | RelationConfig<DrizzleTable>
      | undefined;
    if (!relationConfig || !relationConfig.table) {
      continue;
    }

    const relatedTable = relationConfig.table;

    switch (relationConfig.type) {
      case 'hasOne':
      case 'hasMany': {
        const localKey = relationConfig.localKey || 'id';

        // Collect all unique local values
        const localValues = [
          ...new Set(
            results
              .map((item) => item[localKey])
              .filter((val) => val !== undefined && val !== null),
          ),
        ];

        if (localValues.length === 0) {
          // Set empty results for all items
          results = results.map((item) => ({
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
        results = results.map((item) => {
          const localValue = item[localKey];
          const related = recordsByForeignKey.get(localValue) || [];
          return {
            ...item,
            [relationName]: relationConfig.type === 'hasMany' ? related : related[0] || null,
          };
        });
        break;
      }

      case 'belongsTo': {
        // For belongsTo, the foreign key is on the current item
        const refLocalKey = relationConfig.localKey || 'id';

        // Collect all unique foreign key values
        const foreignValues = [
          ...new Set(
            results
              .map((item) => item[relationConfig.foreignKey])
              .filter((val) => val !== undefined && val !== null),
          ),
        ];

        if (foreignValues.length === 0) {
          // Set null for all items
          results = results.map((item) => ({
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
        results = results.map((item) => {
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
 * drizzle-orm's `Column` type, derived from the value-imported
 * `getTableColumns` so the public surface needs no `import type` from
 * drizzle-orm. Used only inside {@link buildWhereCondition} to launder the
 * local {@link DrizzleColumn} back to the operand type drizzle's comparison
 * operators (including `like`/`ilike`, which take `Column | SQL`) expect.
 */
type RealColumn = ReturnType<typeof getTableColumns>[string];

/**
 * Builds a where condition from filter conditions.
 */
export function buildWhereCondition(
  table: DrizzleTable,
  filter: FilterCondition,
): DrizzleSql | undefined {
  const column = getColumn(table, filter.field) as unknown as RealColumn;

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
      // Exhaustive over FilterOperator: a new operator must be handled here.
      // Unreachable at runtime — operators are validated upstream
      // (`parseFilterValue` / allow-listed query parsing) before reaching an adapter.
      return assertNever(filter.operator);
  }
}

/**
 * Shape of a `SELECT count(*) AS count` row produced by the Drizzle query
 * builder. The builder returns rows as `unknown`, so this names the one row
 * shape the count queries rely on.
 */
export interface CountRow {
  count: number;
}

/**
 * Read the scalar total from a `SELECT count(*) AS count` result, coercing the
 * driver's value to a number and defaulting to `0` when the result is empty.
 * Centralizes the `as CountRow[]` cast that the count/exists/pagination paths
 * would otherwise repeat at every call site.
 */
export function readCount(result: unknown): number {
  return Number((result as CountRow[])[0]?.count) || 0;
}
