import {
  and as _and,
  or as _or,
  asc,
  between,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';
import type {
  FilterCondition,
  IncludeOptions,
  ListFilters,
  MetaInput,
  PaginatedResult,
  RelatedRecord,
  RelationConfig,
  RelationLoaderAdapter,
} from 'hono-crud/internal';
import {
  assertNever,
  batchLoadRelations,
  decodeCursor,
  loadRelationsForItem,
  resolveRelationValueAsync,
} from 'hono-crud/internal';

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
 * The `db` Variables key matches `CONTEXT_KEYS.db` (string value `'db'`), the
 * canonical context slot `getDrizzleDb` reads.
 *
 * @example
 * ```ts
 * import { DrizzleEnv } from '@hono-crud/drizzle';
 *
 * type AppEnv = DrizzleEnv<typeof db>;
 *
 * const app = new Hono<AppEnv>();
 *
 * app.use('*', async (c, next) => {
 *   c.set('db', db); // 'db' is CONTEXT_KEYS.db
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
 * Builds the relation-loader adapter for Drizzle: resolves a relation's
 * {@link DrizzleTable} handle and issues the single `inArray` fetch the core
 * orchestrator drives. Drizzle's query builder satisfies the orchestrator's
 * `PromiseLike<RelatedRecord[]>` `fetchRelated` return.
 */
function drizzleRelationAdapter(
  db: DrizzleDatabaseConstraint,
): RelationLoaderAdapter<DrizzleTable> {
  return {
    resolveRelation: (config) => (config as RelationConfig<DrizzleTable>).table ?? null,
    // Push the owner-scope into the WHERE clause (instead of post-fetch filtering):
    // the related rows are constrained to the caller's tenant + non-soft-deleted in
    // SQL, so cross-tenant rows are never fetched. The core orchestrator still
    // re-filters as a defense-in-depth net.
    fetchRelated: (table, keyField, values, scope) => {
      // Inferred as drizzle's real `SQL[]` (operators return SQLWrapper) so `_and`
      // accepts it — not the local `DrizzleSql` stand-in.
      const conditions = [inArray(getColumn(table, keyField), values)];
      if (scope?.tenantField != null && scope.tenantValue != null) {
        conditions.push(eq(getColumn(table, scope.tenantField), scope.tenantValue));
      }
      if (scope?.excludeDeletedField != null) {
        conditions.push(isNull(getColumn(table, scope.excludeDeletedField)));
      }
      return cast<RelatedRecord>(db)
        .select()
        .from(table)
        .where(conditions.length === 1 ? conditions[0] : _and(...conditions));
    },
  };
}

/**
 * Loads a single related record/collection for a given item using Drizzle
 * queries. Always sets the relation key: hasOne/belongsTo → record-or-null,
 * hasMany → array (including when the gate value is null).
 */
export async function loadDrizzleRelation<T extends Record<string, unknown>>(
  db: DrizzleDatabaseConstraint,
  item: T,
  relationName: string,
  relationConfig: RelationConfig<DrizzleTable>,
): Promise<T> {
  const table = relationConfig.table;
  if (!table) {
    // Can't load relation without table reference
    return item;
  }
  const adapter = drizzleRelationAdapter(db);
  const value = await resolveRelationValueAsync(item, relationConfig, table, adapter.fetchRelated);
  return { ...item, [relationName]: value } as T;
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
  return loadRelationsForItem(item, meta, drizzleRelationAdapter(db), includeOptions);
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
  return batchLoadRelations(items, meta, drizzleRelationAdapter(db), includeOptions);
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
 *
 * `dialect` drives the `like`/`ilike` substring matching (see
 * {@link substringMatch}); all other operators are dialect-agnostic.
 */
export function buildWhereCondition(
  table: DrizzleTable,
  filter: FilterCondition,
  dialect: DrizzleDialect = 'sqlite',
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
      // Literal substring match; case behavior follows the database
      // collation. User-supplied `%` is stripped (memory/prisma parity)
      // and `_` is inert — substringMatch has no wildcard surface.
      return substringMatch(column, String(filter.value).replace(/%/g, ''), dialect, {
        caseSensitive: true,
      });
    case 'ilike':
      // Always case-insensitive literal substring match (cross-adapter
      // contract; drizzle-orm's ilike() is PostgreSQL-only SQL).
      return substringMatch(column, String(filter.value).replace(/%/g, ''), dialect);
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

/**
 * Options for executing a Drizzle list query.
 */
export interface DrizzleListQueryOptions {
  /** Database (or transaction) handle. */
  db: unknown;
  /** The Drizzle table to query. */
  table: DrizzleTable;
  /** List filters from the request. */
  filters: ListFilters;
  /** SQL dialect (drives the substring-match SQL on the `?search=` path). */
  dialect: DrizzleDialect;
  /** Search fields for the generic `?search=` needle (optional). */
  searchFields?: string[];
  /** Soft delete configuration (optional). */
  softDeleteConfig?: { enabled: boolean; field: string };
  /** Default items per page. */
  defaultPerPage?: number;
  /**
   * Pre-built conditions ANDed into the WHERE clause — the search endpoint's
   * custom search SQL (tsvector or substring-position) plugs in here.
   */
  extraConditions?: DrizzleSql[];
  /**
   * Keyset (cursor) pagination field. When set, a request carrying
   * `cursor`/`limit` options runs the keyset window (`WHERE cursorField >
   * decoded` + `LIMIT n+1`) instead of offset pagination. Only the List
   * endpoint passes this.
   */
  cursorField?: string;
}

/**
 * Result of a Drizzle list query.
 */
export interface DrizzleListQueryResult<Row = Record<string, unknown>> {
  /** The fetched records (in cursor mode: up to `limit + 1` rows). */
  records: Row[];
  /** Total count of matching records (never includes the cursor window condition). */
  totalCount: number;
  /** Current page number. */
  page: number;
  /** Items per page. */
  perPage: number;
  /** Total number of pages. */
  totalPages: number;
  /**
   * Present when the keyset (cursor) window ran instead of offset
   * pagination. The offset fields above are then not meaningful — build the
   * envelope with core's `buildCursorPage`.
   */
  cursor?: { limit: number; applied: boolean };
}

/**
 * Executes the common Drizzle list query with filtering, search, sorting, and
 * pagination — the drizzle mirror of the prisma adapter's
 * `executePrismaQuery`. Shared by the List, Search, and Export endpoints so
 * the query semantics cannot drift.
 *
 * Cursor mode (when `cursorField` is set and the request carries
 * `cursor`/`limit` options) applies a strictly-greater keyset predicate on
 * the cursor column and overfetches one row as the has-more sentinel. The
 * ordering is already forced to the cursor field ascending by core's
 * `parseListFilters`, so the regular `order_by` block emits the correct
 * ORDER BY. An invalid cursor starts from the beginning. Unlike Prisma's
 * native cursor, the keyset predicate tolerates a deleted boundary row.
 */
export async function executeDrizzleListQuery<Row = Record<string, unknown>>(
  options: DrizzleListQueryOptions,
): Promise<DrizzleListQueryResult<Row>> {
  const {
    db,
    table,
    filters,
    dialect,
    searchFields = [],
    softDeleteConfig,
    defaultPerPage = 20,
    extraConditions = [],
    cursorField,
  } = options;

  const conditions: DrizzleSql[] = [];

  // Apply soft delete filter
  if (softDeleteConfig?.enabled) {
    const deletedAtColumn = getColumn(table, softDeleteConfig.field);

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
    const condition = buildWhereCondition(table, filter, dialect);
    if (condition) {
      conditions.push(condition);
    }
  }

  // Apply search. Dialect-native substring match (INSTR/POSITION/LOCATE) —
  // the needle is never injected into a LIKE pattern, so user-supplied `%`
  // and `_` are inert literal characters, aligning with memory/Prisma which
  // use literal substring matching.
  if (filters.options.search && searchFields.length > 0) {
    const needle = filters.options.search;
    const searchConditions = searchFields.map((field) =>
      substringMatch(getColumn(table, field), needle, dialect),
    );
    conditions.push(or(...searchConditions)!);
  }

  conditions.push(...extraConditions);

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count using COUNT(*). The keyset window condition is
  // intentionally NOT part of the count — total_count always reflects the
  // full filtered set.
  const countResult = await cast(db)
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(whereClause);

  const totalCount = readCount(countResult);

  // Keyset (cursor) window: strictly after the boundary value.
  const cursorMode =
    cursorField !== undefined &&
    (filters.options.cursor !== undefined || filters.options.limit !== undefined);

  let fetchWhere = whereClause;
  let cursorApplied = false;
  if (cursorMode && filters.options.cursor) {
    const decoded = decodeCursor(filters.options.cursor);
    if (decoded !== null) {
      fetchWhere = and(whereClause, gt(getColumn(table, cursorField), decoded));
      cursorApplied = true;
    }
  }

  // Build main query
  let query = cast<Row>(db).select().from(table).where(fetchWhere);

  // Apply sorting (cursor mode arrives here already forced to cursorField asc)
  if (filters.options.order_by) {
    const orderColumn = getColumn(table, filters.options.order_by);
    const orderFn = filters.options.order_by_direction === 'desc' ? desc : asc;
    query = query.orderBy(orderFn(orderColumn));
  }

  if (cursorMode) {
    const limit = filters.options.limit || filters.options.per_page || defaultPerPage;
    const records = await query.limit(limit + 1);
    return {
      records,
      totalCount,
      page: 0,
      perPage: limit,
      totalPages: 0,
      cursor: { limit, applied: cursorApplied },
    };
  }

  // Apply offset pagination
  const page = filters.options.page || 1;
  const perPage = filters.options.per_page || defaultPerPage;
  const records = await query.limit(perPage).offset((page - 1) * perPage);

  const totalPages = Math.ceil(totalCount / perPage);

  return {
    records,
    totalCount,
    page,
    perPage,
    totalPages,
  };
}

/**
 * Builds a PaginatedResult from offset-mode query results (mirrors the
 * prisma adapter's `buildPaginatedResult`). Cursor-mode results go through
 * core's `buildCursorPage` instead.
 */
export function buildPaginatedResult<T>(
  items: T[],
  queryResult: DrizzleListQueryResult<unknown>,
): PaginatedResult<T> {
  return {
    result: items,
    result_info: {
      page: queryResult.page,
      per_page: queryResult.perPage,
      total_count: queryResult.totalCount,
      total_pages: queryResult.totalPages,
      has_next_page: queryResult.page < queryResult.totalPages,
      has_prev_page: queryResult.page > 1,
    },
  };
}

/**
 * Finds an existing record matching `data` on every upsert key.
 *
 * Soft-deleted rows are matched too: upsert-family endpoints restore them on
 * update ("match-and-restore", see core's `applyUpsertRestore`). Shared by
 * Upsert, Import, and BatchUpsert so the matching semantics cannot drift.
 * Native ON CONFLICT paths cannot go through this helper and may diverge —
 * see the `nativeUpsert` / `nativeBatchUpsert` docs.
 */
export async function findByUpsertKeys<Row>(
  db: unknown,
  table: DrizzleTable,
  getColumnFor: (field: string) => DrizzleColumn,
  data: Record<string, unknown>,
  upsertKeys: string[],
): Promise<Row | null> {
  const conditions: DrizzleSql[] = [];
  for (const key of upsertKeys) {
    const value = data[key];
    if (value !== undefined) {
      conditions.push(eq(getColumnFor(key), value));
    }
  }

  if (conditions.length === 0) {
    return null;
  }

  const result = await cast<Row>(db)
    .select()
    .from(table)
    .where(and(...conditions))
    .limit(1);

  return result[0] || null;
}

/**
 * Emit a dialect-correct substring-match SQL expression.
 *
 * By using the native substring-position function for each dialect, the
 * needle is never injected into a LIKE pattern, so LIKE wildcards (`%`,
 * `_`) and the LIKE escape character lose their special meaning entirely —
 * no wildcard surface means no escape needed.
 *
 * Case-insensitive (default) dialect mapping:
 *   - `'sqlite'` → `INSTR(LOWER(col), LOWER(needle)) > 0`
 *   - `'pg'`     → `POSITION(LOWER(needle) IN LOWER(col)) > 0`
 *   - `'mysql'`  → `LOCATE(LOWER(needle), LOWER(col)) > 0`
 *
 * With `caseSensitive: true` the LOWER() wrapping is dropped, so case
 * behavior follows the database collation (binary on sqlite/pg, the
 * column collation on mysql) — matching the cross-adapter `like`
 * contract on FilterOperator.
 *
 * All three functions return a 1-based position (or 0 for "not found"),
 * so `> 0` is the dialect-agnostic predicate that means "needle is a
 * substring of col".
 */
export function substringMatch(
  col: DrizzleColumn | DrizzleSql,
  needle: string,
  dialect: DrizzleDialect,
  options?: { caseSensitive?: boolean },
): DrizzleSql {
  if (options?.caseSensitive) {
    switch (dialect) {
      case 'pg':
        return sql`POSITION(${needle} IN ${col}) > 0`;
      case 'mysql':
        return sql`LOCATE(${needle}, ${col}) > 0`;
      default:
        // 'sqlite' (default)
        return sql`INSTR(${col}, ${needle}) > 0`;
    }
  }
  switch (dialect) {
    case 'pg':
      return sql`POSITION(LOWER(${needle}) IN LOWER(${col})) > 0`;
    case 'mysql':
      return sql`LOCATE(LOWER(${needle}), LOWER(${col})) > 0`;
    default:
      // 'sqlite' (default)
      return sql`INSTR(LOWER(${col}), LOWER(${needle})) > 0`;
  }
}
