import type { Env } from 'hono';
import { UpsertEndpoint } from 'hono-crud/internal';
import { CloneEndpoint } from 'hono-crud/internal';
import {
  VersionCompareEndpoint,
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionRollbackEndpoint,
} from 'hono-crud/internal';
import { AggregateEndpoint, computeAggregations } from 'hono-crud/internal';
import { isFilterOperator } from 'hono-crud/internal';
import { NotFoundException } from 'hono-crud/internal';
import { SearchEndpoint, searchInMemory } from 'hono-crud/internal';
import { ExportEndpoint } from 'hono-crud/internal';
import { ImportEndpoint } from 'hono-crud/internal';
import type {
  AggregateField,
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
import {
  type PrismaClient,
  type PrismaModelOperations,
  batchLoadPrismaRelations,
  buildPaginatedResult,
  buildPrismaWhere,
  executePrismaQuery,
  escapeLikeWildcards,
  findByUpsertKeys,
  getPrismaModel,
} from './helpers';
import { getPrismaClient } from './connection';

/**
 * Prisma Search endpoint.
 * Provides full-text search with relevance scoring and highlighting.
 */
export abstract class PrismaSearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  /**
   * Builds search-specific WHERE clause with search conditions and filters.
   */
  protected buildSearchWhere(
    options: SearchOptions,
    filters: ListFilters,
  ): Record<string, unknown> {
    // Start with base filters
    let where = buildPrismaWhere(filters.filters);

    // Apply soft delete filter (exclude deleted records by default)
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled) {
      const { withDeleted, onlyDeleted } = filters.options;
      if (onlyDeleted) {
        where[softDeleteConfig.field] = { not: null };
      } else if (!withDeleted) {
        where[softDeleteConfig.field] = null;
      }
    }

    // Build search conditions.
    //
    // SECURITY: Prisma's `contains` compiles to SQL LIKE WITHOUT escaping
    // user input — `%`/`_` act as live wildcards (verified against Postgres
    // via @prisma/adapter-pg), so needles are escaped via
    // escapeLikeWildcards to stay literal, matching memory/drizzle search.
    //
    // mode='all' uses token-AND across fields: each query token must appear
    // in AT LEAST ONE configured field. The prior implementation required
    // EVERY field to contain the WHOLE phrase, which made mode='all'
    // effectively unusable for multi-term queries.
    const searchableFields = this.getSearchableFields();
    const fieldsToSearch = options.fields || Object.keys(searchableFields);

    const fieldContains = (field: string, needle: string) => ({
      [field]: {
        contains: escapeLikeWildcards(needle),
        mode: 'insensitive',
      },
    });

    if (fieldsToSearch.length > 0) {
      if (options.mode === 'all') {
        const tokens = options.query.split(/\s+/).filter((t) => t.length > 0);
        if (tokens.length > 0) {
          where = {
            ...where,
            AND: tokens.map((token) => ({
              OR: fieldsToSearch.map((field) => fieldContains(field, token)),
            })),
          };
        }
      } else {
        // 'any' or 'phrase': phrase OR'd across fields (unchanged semantics).
        where = {
          ...where,
          OR: fieldsToSearch.map((field) => fieldContains(field, options.query)),
        };
      }
    }

    return where;
  }

  /**
   * Performs search on database.
   */
  override async search(
    options: SearchOptions,
    filters: ListFilters,
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const model = await this.getModel();

    // Build WHERE clause with search conditions and soft delete filtering
    const where = this.buildSearchWhere(options, filters);

    // Get total count
    const totalCount = await model.count({ where });

    // Build orderBy (common pattern)
    const orderBy = filters.options.order_by
      ? { [filters.options.order_by]: filters.options.order_by_direction || 'asc' }
      : undefined;

    // Pagination (common pattern)
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;

    // Execute query
    const records = await model.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    });

    // Score results in memory and generate highlights.
    //
    // For mode='all' the WHERE above already enforces token-AND across
    // fields, so we score with mode='any' to avoid `searchInMemory`'s
    // stricter per-field "all tokens in same field" gate dropping
    // correctly-matched rows. The score is used for ranking only — matching
    // was decided in the database query.
    const scoringOptions = options.mode === 'all' ? { ...options, mode: 'any' as const } : options;
    const searchResults = searchInMemory(records, scoringOptions, this.getSearchableFields());

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const items = searchResults.map((r) => r.item);
    const itemsWithRelations = await batchLoadPrismaRelations(
      getPrismaClient(this),
      items,
      this._meta,
      includeOptions,
    );

    // Map relations back to search results
    const resultsWithRelations = searchResults.map((result, index) => ({
      ...result,
      item: itemsWithRelations[index],
    }));

    return {
      items: resultsWithRelations,
      totalCount,
    };
  }
}

/**
 * Prisma Export endpoint.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class PrismaExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic
    const queryResult = await executePrismaQuery({
      model: await this.getModel(),
      filters,
      searchFields: this.searchFields,
      softDeleteConfig: this.getSoftDeleteConfig(),
      defaultPerPage: this.defaultPerPage,
    });

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const itemsWithRelations = await batchLoadPrismaRelations(
      getPrismaClient(this),
      queryResult.records,
      this._meta,
      includeOptions,
    );

    return buildPaginatedResult(itemsWithRelations, queryResult);
  }
}

/**
 * Prisma Import endpoint.
 * Imports data from CSV or JSON with support for create and upsert modes.
 */
export abstract class PrismaImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ImportEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']> | null> {
    return findByUpsertKeys(
      await this.getModel(),
      data as Record<string, unknown>,
      this.getUpsertKeys(),
    );
  }

  /**
   * Creates a new record.
   */
  override async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma');

    const result = await model.create({ data: record });
    return result;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: this.applyManagedUpdateFields(data as Record<string, unknown>),
    });

    return result;
  }
}

/**
 * Prisma Upsert endpoint.
 * Creates a record if it doesn't exist, updates it if it does.
 *
 * Supports native Prisma upsert via `useNativeUpsert = true` for atomic operations.
 */
export abstract class PrismaUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpsertEndpoint<E, M> {
  declare prisma?: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']> | null> {
    return findByUpsertKeys(
      await this.getModel(),
      data as Record<string, unknown>,
      this.getUpsertKeys(),
    );
  }

  /**
   * Creates a new record.
   */
  override async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma');

    const result = await model.create({ data: record });
    return result;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: this.applyManagedUpdateFields(data as Record<string, unknown>),
    });

    return result;
  }

  /**
   * Performs a native Prisma upsert operation.
   */
  protected override async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    _tx?: unknown,
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const model = await this.getModel();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];
    const timestamps = this.getTimestampsConfig();

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    // Resolve managed write-time fields for the CREATE branch
    // (Model.id strategy + createdAt/updatedAt).
    const createData = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma');

    // Build update data - exclude upsert keys and primary key, filter create-only fields
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!upsertKeys.includes(key) && key !== primaryKey) {
        if (!this.createOnlyFields?.includes(key)) {
          updateData[key] = value;
        }
      }
    }
    // `updatedAt` is server-managed on the UPDATE branch — always bump it,
    // ignoring any client-supplied value, and never touch `createdAt`.
    if (timestamps.enabled) {
      updateData[timestamps.updatedAt] = Date.now();
    }

    const result = await model.upsert({
      where,
      create: createData,
      update: Object.keys(updateData).length > 0 ? updateData : {},
    });

    return {
      data: result,
      created: false, // Cannot determine with native upsert
    };
  }
}

/**
 * Prisma Version History endpoint.
 * Lists all versions for a record.
 */
export abstract class PrismaVersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionHistoryEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  protected override async recordExists(lookupValue: string): Promise<boolean> {
    const model = await this.getModel();

    const count = await model.count({
      where: { [this.lookupField]: lookupValue },
    });

    return count > 0;
  }
}

/**
 * Prisma Version Read endpoint.
 * Gets a specific version of a record.
 */
export abstract class PrismaVersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionReadEndpoint<E, M> {}

/**
 * Prisma Version Compare endpoint.
 * Compares two versions of a record.
 */
export abstract class PrismaVersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionCompareEndpoint<E, M> {}

/**
 * Prisma Version Rollback endpoint.
 * Rolls back a record to a previous version.
 */
export abstract class PrismaVersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionRollbackEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  override async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number,
  ): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();
    const versionField = this.getVersioningConfig().field;
    const primaryKey = this._meta.model.primaryKeys[0];

    // Find the existing record
    const existing = await model.findFirst({
      where: { [this.lookupField]: lookupValue },
    });

    if (!existing) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Update the record with version data and new version number
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: {
        ...versionData,
        [versionField]: newVersion,
      },
    });

    return result;
  }
}

/**
 * Prisma Aggregate endpoint.
 * Computes aggregations (COUNT, SUM, AVG, MIN, MAX) with GROUP BY support.
 */
export abstract class PrismaAggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends AggregateEndpoint<E, M> {
  declare prisma?: PrismaClient;

  /**
   * Whether to use native Prisma aggregations.
   * Set to false to fall back to in-memory computation.
   * Default: true
   */
  protected useNativeAggregation = true;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  /**
   * Builds the where clause for aggregation queries.
   *
   * Filter operators reach this path UNVALIDATED (unlike the list path, which
   * runs through allow-listed query parsing), so each operator is checked with
   * `isFilterOperator` and conversion is delegated to the canonical
   * `buildPrismaWhere` rather than a duplicated inline switch. A field carrying
   * any unrecognized operator fails CLOSED — it matches NOTHING (`{ in: [] }`)
   * instead of forwarding an arbitrary operator string into the Prisma query.
   */
  protected async buildAggregateWhere(options: AggregateOptions): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};

    // Apply soft delete filter
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled) {
      const { query } = await this.getValidatedData();
      const withDeleted = query?.withDeleted === true || query?.withDeleted === 'true';

      if (!withDeleted) {
        where[softDeleteConfig.field] = null;
      }
    }

    // Apply filters
    if (options.filters) {
      const conditions: FilterCondition[] = [];
      const matchNothingFields: string[] = [];

      for (const [field, value] of Object.entries(options.filters)) {
        if (typeof value === 'object' && value !== null) {
          // Operator syntax: { field: { op: value } }
          const ops = Object.entries(value as Record<string, unknown>);
          if (ops.some(([op]) => !isFilterOperator(op))) {
            matchNothingFields.push(field);
            continue;
          }
          for (const [op, opValue] of ops) {
            // `isFilterOperator` narrowed every `op` above.
            if (isFilterOperator(op)) {
              conditions.push({ field, operator: op, value: opValue });
            }
          }
        } else {
          // Simple equality
          conditions.push({ field, operator: 'eq', value });
        }
      }

      Object.assign(where, buildPrismaWhere(conditions));

      // A field with an unrecognized operator matches nothing.
      for (const field of matchNothingFields) {
        where[field] = { in: [] };
      }
    }

    return where;
  }

  override async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const model = await this.getModel();
    const where = await this.buildAggregateWhere(options);

    // Fall back to in-memory computation if native aggregation is disabled
    // or if there are HAVING clauses (not supported by Prisma aggregate)
    if (!this.useNativeAggregation || options.having) {
      const records = await model.findMany({ where });
      return computeAggregations(records, options);
    }

    // For groupBy queries, use Prisma's groupBy
    if (options.groupBy?.length) {
      return this.aggregateWithGroupBy(model, where, options);
    }

    // For simple aggregations without groupBy, use Prisma's aggregate method
    return this.aggregateSimple(model, where, options);
  }

  /**
   * Groups aggregation fields by operation type.
   */
  protected groupAggregationsByOperation(aggregations: AggregateField[]): {
    sum: string[];
    avg: string[];
    min: string[];
    max: string[];
    count: string[];
    countDistinct: string[];
  } {
    const grouped = {
      sum: [] as string[],
      avg: [] as string[],
      min: [] as string[],
      max: [] as string[],
      count: [] as string[],
      countDistinct: [] as string[],
    };

    for (const agg of aggregations) {
      switch (agg.operation) {
        case 'sum':
          grouped.sum.push(agg.field);
          break;
        case 'avg':
          grouped.avg.push(agg.field);
          break;
        case 'min':
          grouped.min.push(agg.field);
          break;
        case 'max':
          grouped.max.push(agg.field);
          break;
        case 'count':
          grouped.count.push(agg.field);
          break;
        case 'countDistinct':
          grouped.countDistinct.push(agg.field);
          break;
      }
    }

    return grouped;
  }

  /**
   * Performs aggregation without groupBy using native Prisma aggregate.
   */
  protected async aggregateSimple(
    model: PrismaModelOperations<ModelObject<M['model']>>,
    where: Record<string, unknown>,
    options: AggregateOptions,
  ): Promise<AggregateResult> {
    const aggregateArgs: Record<string, unknown> = { where };
    const values: Record<string, number | null> = {};

    // Group aggregations by operation type
    const grouped = this.groupAggregationsByOperation(options.aggregations);

    // Always include count
    aggregateArgs._count = true;

    // Build aggregation fields
    if (grouped.sum.length) {
      aggregateArgs._sum = {};
      for (const field of grouped.sum) {
        (aggregateArgs._sum as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.avg.length) {
      aggregateArgs._avg = {};
      for (const field of grouped.avg) {
        (aggregateArgs._avg as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.min.length) {
      aggregateArgs._min = {};
      for (const field of grouped.min) {
        (aggregateArgs._min as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.max.length) {
      aggregateArgs._max = {};
      for (const field of grouped.max) {
        (aggregateArgs._max as Record<string, boolean>)[field] = true;
      }
    }

    // Execute native aggregation. `aggregate` is part of PrismaModelOperations,
    // so the resolved model exposes it directly — no delegate re-resolution.
    try {
      const result = await model.aggregate(aggregateArgs);

      // Map results to our format
      if (result._count !== undefined) {
        values.count =
          typeof result._count === 'object'
            ? ((result._count as { _all?: number })._all ?? 0)
            : (result._count as number);
      }

      if (result._sum && grouped.sum.length) {
        for (const field of grouped.sum) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`sum${camelField}`] =
            ((result._sum as Record<string, unknown>)[field] as number) ?? 0;
        }
      }

      if (result._avg && grouped.avg.length) {
        for (const field of grouped.avg) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`avg${camelField}`] =
            ((result._avg as Record<string, unknown>)[field] as number) ?? 0;
        }
      }

      if (result._min && grouped.min.length) {
        for (const field of grouped.min) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`min${camelField}`] = (result._min as Record<string, unknown>)[field] as
            | number
            | null;
        }
      }

      if (result._max && grouped.max.length) {
        for (const field of grouped.max) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`max${camelField}`] = (result._max as Record<string, unknown>)[field] as
            | number
            | null;
        }
      }

      return { values, groups: [] };
    } catch (error) {
      // Fall back to in-memory computation if native aggregation fails
      const records = await model.findMany({ where });
      return computeAggregations(records, options);
    }
  }

  /**
   * Performs aggregation with groupBy using native Prisma groupBy.
   */
  protected async aggregateWithGroupBy(
    model: PrismaModelOperations<ModelObject<M['model']>>,
    where: Record<string, unknown>,
    options: AggregateOptions,
  ): Promise<AggregateResult> {
    const groupByArgs: Record<string, unknown> = {
      by: options.groupBy,
      where,
    };

    // Group aggregations by operation type
    const grouped = this.groupAggregationsByOperation(options.aggregations);

    // Build aggregation fields
    groupByArgs._count = true;

    if (grouped.sum.length) {
      groupByArgs._sum = {};
      for (const field of grouped.sum) {
        (groupByArgs._sum as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.avg.length) {
      groupByArgs._avg = {};
      for (const field of grouped.avg) {
        (groupByArgs._avg as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.min.length) {
      groupByArgs._min = {};
      for (const field of grouped.min) {
        (groupByArgs._min as Record<string, boolean>)[field] = true;
      }
    }

    if (grouped.max.length) {
      groupByArgs._max = {};
      for (const field of grouped.max) {
        (groupByArgs._max as Record<string, boolean>)[field] = true;
      }
    }

    // Execute native groupBy. `groupBy` is part of PrismaModelOperations, so the
    // resolved model exposes it directly — no delegate re-resolution.
    try {
      const results = await model.groupBy(groupByArgs);

      // Map results to our format
      const groups: Array<{ key: Record<string, unknown>; values: Record<string, number | null> }> =
        results.map((result) => {
          const key: Record<string, unknown> = {};
          const groupValues: Record<string, number | null> = {};

          // Add group key values
          for (const field of options.groupBy!) {
            key[field] = result[field];
          }

          // Add count
          groupValues.count =
            typeof result._count === 'object'
              ? ((result._count as { _all?: number })._all ?? 0)
              : ((result._count as number) ?? 0);

          // Add aggregations
          if (result._sum && grouped.sum.length) {
            for (const field of grouped.sum) {
              const camelField = field.charAt(0).toUpperCase() + field.slice(1);
              groupValues[`sum${camelField}`] =
                ((result._sum as Record<string, unknown>)[field] as number) ?? 0;
            }
          }

          if (result._avg && grouped.avg.length) {
            for (const field of grouped.avg) {
              const camelField = field.charAt(0).toUpperCase() + field.slice(1);
              groupValues[`avg${camelField}`] =
                ((result._avg as Record<string, unknown>)[field] as number) ?? 0;
            }
          }

          if (result._min && grouped.min.length) {
            for (const field of grouped.min) {
              const camelField = field.charAt(0).toUpperCase() + field.slice(1);
              groupValues[`min${camelField}`] = (result._min as Record<string, unknown>)[field] as
                | number
                | null;
            }
          }

          if (result._max && grouped.max.length) {
            for (const field of grouped.max) {
              const camelField = field.charAt(0).toUpperCase() + field.slice(1);
              groupValues[`max${camelField}`] = (result._max as Record<string, unknown>)[field] as
                | number
                | null;
            }
          }

          return { key, values: groupValues };
        });

      // Calculate overall values from groups
      const values: Record<string, number | null> = {
        count: groups.reduce((sum, g) => sum + ((g.values.count as number) || 0), 0),
      };

      return { values, groups };
    } catch (error) {
      // Fall back to in-memory computation if native groupBy fails
      const records = await model.findMany({ where });
      return computeAggregations(records, options);
    }
  }
}

/**
 * Prisma Clone endpoint.
 *
 * Reads the source row by `lookupField`, lets the base `CloneEndpoint`
 * strip primary keys + `excludeFromClone` fields and apply body overrides,
 * then inserts the result with a freshly-generated primary key.
 *
 * Soft-deleted source rows are not cloneable — the WHERE clause adds a
 * `<field>: null` predicate when the model has soft-delete configured.
 *
 * Composite-PK note: the base class strips ALL primary keys but this
 * implementation only fills `primaryKeys[0]` via `generateId()`. Models with
 * composite primary keys must subclass and override `createClone` to fill the
 * remaining columns.
 *
 * Override `generateId()` to swap UUIDv4 for ULID/snowflake/etc.
 */
export abstract class PrismaCloneEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CloneEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model.tableName);
  }

  /** Generates the primary-key value for the cloned row. Defaults to UUIDv4. */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  override async findSource(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const result = await model.findFirst({ where });
    if (!result) return null;

    return result;
  }

  override async createClone(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    // `generateId()` remains the overridable default-branch generator for
    // the `'uuid'`/unset strategy; `function`/`'database'` take precedence.
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma', () =>
      this.generateId(),
    );

    const result = await model.create({ data: record });
    return result;
  }
}
