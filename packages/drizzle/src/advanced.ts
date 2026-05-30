import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Column, SQL, Table } from 'drizzle-orm';
import type { Env } from 'hono';
import { UpsertEndpoint } from 'hono-crud/internal';
import { BatchUpsertEndpoint } from 'hono-crud/internal';
import { CloneEndpoint } from 'hono-crud/internal';
import {
  VersionCompareEndpoint,
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionRollbackEndpoint,
} from 'hono-crud/internal';
import { AggregateEndpoint, computeAggregations } from 'hono-crud/internal';
import { SearchEndpoint, searchInMemory } from 'hono-crud/internal';
import { ExportEndpoint } from 'hono-crud/internal';
import { ImportEndpoint } from 'hono-crud/internal';
import type {
  AggregateOptions,
  AggregateResult,
  FilterCondition,
  IncludeOptions,
  ListFilters,
  MetaInput,
  PaginatedResult,
  SearchOptions,
  SearchResult,
} from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { getDrizzleDb } from './connection';
import {
  type DrizzleDatabase,
  type DrizzleDialect,
  batchLoadDrizzleRelations,
  buildWhereCondition,
  cast,
  getColumn,
  getTable,
  readCount,
} from './helpers';

/**
 * Emit a dialect-correct case-insensitive substring-match SQL expression.
 *
 * Replaces the previous `LOWER(col) LIKE LOWER('%needle%') ESCAPE '\\'`
 * approach: by using the native substring-position function for each
 * dialect, the needle is never injected into a pattern, so LIKE
 * wildcards (`%`, `_`) and the LIKE escape character lose their
 * special meaning entirely — no wildcard surface means no escape
 * needed.
 *
 * Dialect mapping:
 *   - `'sqlite'` → `INSTR(LOWER(col), LOWER(needle)) > 0`
 *   - `'pg'`     → `POSITION(LOWER(needle) IN LOWER(col)) > 0`
 *   - `'mysql'`  → `LOCATE(LOWER(needle), LOWER(col)) > 0`
 *
 * All three return a 1-based position (or 0 for "not found"), so
 * `> 0` is the dialect-agnostic predicate that means "needle is a
 * substring of col".
 */
export function substringMatch(col: Column | SQL, needle: string, dialect: DrizzleDialect): SQL {
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

/**
 * Split a search query into whitespace-delimited tokens for the
 * SQL pre-filter used by `mode='all'`. Empty tokens are dropped.
 *
 * Final relevance scoring still happens in-memory via
 * `searchInMemory`, which applies stopword filtering and tokenizes
 * with its own rules — this function only narrows the SQL result
 * set so the pre-filter is consistent with the abstract layer's
 * notion of "all tokens must match".
 */
function tokenizeForSearch(query: string): string[] {
  return query.split(/\s+/).filter((t) => t.length > 0);
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

  /**
   * SQL dialect of the underlying Drizzle database.
   *
   * Used to branch dialect-specific behavior — currently the native upsert
   * path (`ON CONFLICT DO UPDATE` for sqlite/pg vs `ON DUPLICATE KEY UPDATE`
   * for mysql). Set via {@link createDrizzleCrud}'s `options.dialect`, or
   * override in your subclass. Defaults to `'sqlite'` for backward
   * compatibility with pre-existing portable behavior.
   */
  protected dialect: DrizzleDialect = 'sqlite';

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    return getDrizzleDb(this);
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async findExisting(
    data: Partial<ModelObject<M['model']>>,
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

  override async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle');

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(this.applyManagedUpdateFields(data as Record<string, unknown>))
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
    _tx?: unknown,
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const table = this.getTable();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];
    const softDeleteConfig = this.getSoftDeleteConfig();
    const timestamps = this.getTimestampsConfig();

    // Resolve managed write-time fields for the INSERT branch
    // (Model.id strategy + createdAt/updatedAt).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle');

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
    // `updatedAt` is server-managed on the DO UPDATE branch — always bump it,
    // ignoring any client-supplied value, and never touch `createdAt`.
    if (timestamps.enabled) {
      updateSet[timestamps.updatedAt] = Date.now();
    }

    // Get the target columns for conflict detection
    const targetColumns = upsertKeys.map((key) => this.getColumn(key));

    // Build condition for soft delete - only update non-deleted records
    let whereCondition: SQL | undefined;
    if (softDeleteConfig.enabled) {
      whereCondition = isNull(this.getColumn(softDeleteConfig.field));
    }

    const setClause: Record<string, unknown> =
      Object.keys(updateSet).length > 0
        ? updateSet
        : { [primaryKey]: sql`${this.getColumn(primaryKey)}` };

    const insertQuery = cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>);

    // Dialect-driven upsert: MySQL uses `ON DUPLICATE KEY UPDATE`, every
    // other supported dialect (sqlite, pg) uses `ON CONFLICT DO UPDATE`.
    // Upstream driver errors bubble — no broad catch.
    if (this.dialect === 'mysql') {
      const result = await insertQuery.onDuplicateKeyUpdate({ set: setClause }).returning();

      return {
        data: result[0] as ModelObject<M['model']>,
        created: false, // Cannot accurately determine with native upsert
      };
    }

    const result = await insertQuery
      .onConflictDoUpdate({
        target: targetColumns,
        set: setClause,
        where: whereCondition,
      })
      .returning();

    return {
      data: result[0] as ModelObject<M['model']>,
      created: false, // Cannot accurately determine with native upsert
    };
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

  /**
   * SQL dialect of the underlying Drizzle database. See
   * {@link DrizzleUpsertEndpoint.dialect} for full semantics.
   */
  protected dialect: DrizzleDialect = 'sqlite';

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    return getDrizzleDb(this);
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async findExisting(
    data: Partial<ModelObject<M['model']>>,
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

  override async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle');

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }

  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(this.applyManagedUpdateFields(data as Record<string, unknown>))
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
    _tx?: unknown,
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
    const timestamps = this.getTimestampsConfig();

    // Resolve managed write-time fields for the INSERT branch of every row
    // (Model.id strategy + createdAt/updatedAt).
    const records = items.map((item) =>
      this.applyManagedInsertFields(item as Record<string, unknown>, 'drizzle'),
    );

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
    // `updatedAt` is server-managed on the DO UPDATE branch — always bump it
    // to a fresh server timestamp, never touch `createdAt`.
    if (timestamps.enabled) {
      updateSet[timestamps.updatedAt] = Date.now();
    }

    // Get the target columns for conflict detection
    const targetColumns = upsertKeys.map((key) => this.getColumn(key));

    const setClause: Record<string, unknown> =
      Object.keys(updateSet).length > 0
        ? updateSet
        : { [primaryKey]: sql`${this.getColumn(primaryKey)}` };

    const insertQuery = cast(this.getDb())
      .insert(table)
      .values(records as Record<string, unknown>[]);

    // Dialect-driven upsert: MySQL uses `ON DUPLICATE KEY UPDATE`, every
    // other supported dialect (sqlite, pg) uses `ON CONFLICT DO UPDATE`.
    // Upstream driver errors bubble — no broad catch.
    const result = await (this.dialect === 'mysql'
      ? insertQuery.onDuplicateKeyUpdate({ set: setClause })
      : insertQuery.onConflictDoUpdate({
          target: targetColumns,
          set: setClause,
        })
    ).returning();

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
    return getDrizzleDb(this);
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

    return readCount(result) > 0;
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
    return getDrizzleDb(this);
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
    newVersion: number,
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
    return getDrizzleDb(this);
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
 * For SQLite/MySQL/PostgreSQL non-vector mode, it falls back to dialect-native
 * substring-position search (INSTR/POSITION/LOCATE) with in-memory scoring.
 *
 * Features:
 * - PostgreSQL: Uses to_tsvector() and plainto_tsquery() for native full-text search
 * - Fallback: dialect-native substring match with in-memory scoring
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

  /**
   * SQL dialect of the underlying Drizzle database.
   *
   * Drives the substring-match function emitted on the fallback search path:
   * `INSTR` for sqlite, `POSITION` for pg, `LOCATE` for mysql. Set via
   * {@link createDrizzleCrud}'s `options.dialect`, or override in your
   * subclass. Defaults to `'sqlite'` for backward compatibility with
   * pre-existing portable behavior.
   *
   * See {@link DrizzleUpsertEndpoint.dialect} for full semantics.
   */
  protected dialect: DrizzleDialect = 'sqlite';

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    return getDrizzleDb(this);
  }

  /**
   * Enable PostgreSQL native full-text search.
   * When true and vectorColumn is set, uses tsvector/tsquery.
   * When false, uses substring-position-based search with in-memory scoring.
   */
  protected useNativeSearch = false;

  /**
   * PostgreSQL tsvector column name for native full-text search.
   * If set and useNativeSearch is true, searches against this column.
   */
  protected vectorColumn?: string;

  /**
   * PostgreSQL text search configuration (e.g., 'english', 'simple').
   */
  protected vectorConfig = 'english';

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
    filters: ListFilters,
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
      const tsQuery =
        options.mode === 'phrase'
          ? sql`phraseto_tsquery(${this.vectorConfig}, ${options.query})`
          : options.mode === 'all'
            ? sql`plainto_tsquery(${this.vectorConfig}, ${options.query})`
            : sql`to_tsquery(${this.vectorConfig}, ${options.query.split(/\s+/).join(' | ')})`;

      conditions.push(sql`${vectorCol} @@ ${tsQuery}`);
    } else {
      // Fallback: dialect-native substring-position search.
      //
      // The needle is matched via INSTR/POSITION/LOCATE rather than LIKE,
      // so user-supplied `%` and `_` are inert literal characters — no
      // wildcard surface, no escape sequence needed. `q=%%` matches only
      // rows containing the literal "%%" substring; `q=foo_bar` matches
      // only rows containing literal "foo_bar". The cast-to-text + LOWER
      // pair preserves the previous case-insensitive semantics.
      //
      // mode='all' uses token-AND across fields: each query token must be
      // present in at least ONE configured field. The prior implementation
      // required EVERY field to contain the WHOLE phrase, which made
      // mode='all' effectively unusable for multi-term queries.
      const buildFieldMatch = (field: string, needle: string): SQL | undefined => {
        try {
          const column = this.getColumn(field);
          return substringMatch(sql`CAST(${column} AS TEXT)`, needle, this.dialect);
        } catch {
          return undefined;
        }
      };

      if (options.mode === 'all') {
        // Token-AND across fields: for each token, AT LEAST ONE field must
        // match (OR within token); ALL tokens must match (AND across tokens).
        const tokens = tokenizeForSearch(options.query);
        if (tokens.length > 0) {
          const tokenClauses: SQL[] = [];
          for (const token of tokens) {
            const perFieldOr = fieldsToSearch
              .map((field) => buildFieldMatch(field, token))
              .filter((c): c is SQL => c !== undefined);
            if (perFieldOr.length > 0) {
              tokenClauses.push(or(...perFieldOr)!);
            }
          }
          if (tokenClauses.length > 0) {
            conditions.push(and(...tokenClauses)!);
          }
        }
      } else {
        // 'any' or 'phrase': phrase OR'd across fields (unchanged semantics).
        const searchConditions = fieldsToSearch
          .map((field) => buildFieldMatch(field, options.query))
          .filter((c): c is SQL => c !== undefined);

        if (searchConditions.length > 0) {
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

    const totalCount = readCount(countResult);

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

    // Score results in memory and generate highlights.
    //
    // For mode='all' the SQL above already enforces token-AND across fields,
    // so we score with mode='any' to avoid `searchInMemory`'s stricter
    // per-field "all tokens in same field" gate dropping correctly-matched
    // rows. The score is used for ranking only — matching was decided in SQL.
    const scoringOptions = options.mode === 'all' ? { ...options, mode: 'any' as const } : options;
    const searchResults = searchInMemory(
      records as ModelObject<M['model']>[],
      scoringOptions,
      searchableFields,
    );

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };

    // Extract items for batch relation loading
    const items = searchResults.map((r) => r.item as Record<string, unknown>);
    const itemsWithRelations = await batchLoadDrizzleRelations(
      this.getDb(),
      items,
      this._meta,
      includeOptions,
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

  /**
   * SQL dialect of the underlying Drizzle database. Drives the
   * substring-match function emitted on the `?search=` path. See
   * {@link DrizzleUpsertEndpoint.dialect} for full semantics.
   */
  protected dialect: DrizzleDialect = 'sqlite';

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    return getDrizzleDb(this);
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
      const needle = filters.options.search;
      const searchConditions = this.searchFields.map((field) => {
        const column = this.getColumn(field);
        return substringMatch(column, needle, this.dialect);
      });
      conditions.push(or(...searchConditions)!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await cast(this.getDb())
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(whereClause);

    const totalCount = readCount(countResult);

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
      includeOptions,
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
    return getDrizzleDb(this);
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
    data: Partial<ModelObject<M['model']>>,
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
  override async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle');

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
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const table = this.getTable();
    const pk = this._meta.model.primaryKeys[0];
    const pkValue = (existing as Record<string, unknown>)[pk];

    const result = await cast(this.getDb())
      .update(table)
      .set(this.applyManagedUpdateFields(data as Record<string, unknown>))
      .where(eq(this.getColumn(pk), pkValue))
      .returning();

    return result[0] as ModelObject<M['model']>;
  }
}

/**
 * Drizzle Clone endpoint.
 *
 * Reads the source row by `lookupField`, lets the base `CloneEndpoint`
 * strip primary keys + `excludeFromClone` fields and apply body overrides,
 * then inserts the result with a freshly-generated primary key.
 *
 * Soft-deleted source rows are not cloneable — the SELECT predicate adds
 * `IS NULL` on the soft-delete column when the model has soft-delete
 * configured.
 *
 * Composite-PK note: the base class strips ALL primary keys but this
 * implementation only fills `primaryKeys[0]` via `generateId()`. Models with
 * composite primary keys must subclass and override `createClone` to fill the
 * remaining columns.
 *
 * Override `generateId()` to swap UUIDv4 for ULID/snowflake/etc.
 */
export abstract class DrizzleCloneEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CloneEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    return getDrizzleDb(this);
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  /** Generates the primary-key value for the cloned row. Defaults to UUIDv4. */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  override async findSource(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    const conditions: SQL[] = [eq(lookupColumn, lookupValue)];

    if (additionalFilters) {
      for (const [field, value] of Object.entries(additionalFilters)) {
        conditions.push(eq(this.getColumn(field), value));
      }
    }

    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    const result = await cast(this.getDb())
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    if (!result[0]) return null;

    return result[0] as ModelObject<M['model']>;
  }

  override async createClone(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    // The long-standing overridable `generateId()` remains the default-branch
    // generator for the `'uuid'`/unset strategy; a `function`/`'database'`
    // strategy takes precedence.
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'drizzle', () =>
      this.generateId(),
    );

    const result = await cast(this.getDb())
      .insert(table)
      .values(record as Record<string, unknown>)
      .returning();

    return result[0] as ModelObject<M['model']>;
  }
}
