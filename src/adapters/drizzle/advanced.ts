import type { Env } from 'hono';
import { eq, and, isNull, isNotNull, or, asc, desc, sql } from 'drizzle-orm';
import type { SQL, Table, Column } from 'drizzle-orm';
import { UpsertEndpoint } from '../../endpoints/upsert';
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
  AggregateOptions,
  AggregateResult,
  SearchOptions,
  SearchResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type DrizzleDatabase,
  cast,
  getTable,
  getColumn,
  batchLoadDrizzleRelations,
  buildWhereCondition,
} from './helpers';

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
