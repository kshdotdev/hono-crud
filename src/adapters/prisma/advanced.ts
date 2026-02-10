import type { Env } from 'hono';
import { UpsertEndpoint } from '../../endpoints/upsert';
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
  SearchOptions,
  SearchResult,
  AggregateOptions,
  AggregateResult,
  AggregateField,
  IncludeOptions,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type PrismaClient,
  type PrismaModelOperations,
  getPrismaModel,
  getModelName,
  buildPrismaWhere,
  batchLoadPrismaRelations,
  executePrismaQuery,
  buildPaginatedResult,
} from './helpers';

/**
 * Prisma Search endpoint.
 * Provides full-text search with relevance scoring and highlighting.
 */
export abstract class PrismaSearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Builds search-specific WHERE clause with search conditions and filters.
   */
  protected buildSearchWhere(
    options: SearchOptions,
    filters: ListFilters
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

    // Build search conditions
    const searchableFields = this.getSearchableFields();
    const fieldsToSearch = options.fields || Object.keys(searchableFields);

    const searchConditions = fieldsToSearch.map((field) => ({
      [field]: {
        contains: options.query,
        mode: 'insensitive',
      },
    }));

    // Combine with filters based on search mode
    if (searchConditions.length > 0) {
      if (options.mode === 'all') {
        // AND all search conditions
        where = { ...where, AND: searchConditions };
      } else {
        // OR search conditions (for 'any' and 'phrase' modes)
        where = { ...where, OR: searchConditions };
      }
    }

    return where;
  }

  /**
   * Performs search on database.
   */
  override async search(
    options: SearchOptions,
    filters: ListFilters
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const model = this.getModel();

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

    // Score results in memory and generate highlights
    const searchResults = searchInMemory(
      records as ModelObject<M['model']>[],
      options,
      this.getSearchableFields()
    );

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const items = searchResults.map(r => r.item as Record<string, unknown>);
    const itemsWithRelations = await batchLoadPrismaRelations(
      this.prisma,
      items,
      this._meta,
      includeOptions
    );

    // Map relations back to search results
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
 * Prisma Export endpoint.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class PrismaExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic
    const queryResult = await executePrismaQuery({
      model: this.getModel(),
      filters,
      searchFields: this.searchFields,
      softDeleteConfig: this.getSoftDeleteConfig(),
      defaultPerPage: this.defaultPerPage,
    });

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const itemsWithRelations = await batchLoadPrismaRelations(
      this.prisma,
      queryResult.records as Record<string, unknown>[],
      this._meta,
      includeOptions
    );

    return buildPaginatedResult(
      itemsWithRelations as ModelObject<M['model']>[],
      queryResult
    );
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
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const upsertKeys = this.getUpsertKeys();

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    if (Object.keys(where).length === 0) {
      return null;
    }

    const result = await model.findFirst({ where });
    return (result as ModelObject<M['model']>) || null;
  }

  /**
   * Creates a new record.
   */
  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await model.create({ data: record });
    return result as ModelObject<M['model']>;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data,
    });

    return result as ModelObject<M['model']>;
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
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const upsertKeys = this.getUpsertKeys();

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    if (Object.keys(where).length === 0) {
      return null;
    }

    const result = await model.findFirst({ where });
    return (result as ModelObject<M['model']>) || null;
  }

  /**
   * Creates a new record.
   */
  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await model.create({ data: record });
    return result as ModelObject<M['model']>;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data,
    });

    return result as ModelObject<M['model']>;
  }

  /**
   * Performs a native Prisma upsert operation.
   */
  protected override async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    _tx?: unknown
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const model = this.getModel();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    // Build create data with generated UUID
    const createData = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    // Build update data - exclude upsert keys and primary key, filter create-only fields
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!upsertKeys.includes(key) && key !== primaryKey) {
        if (!this.createOnlyFields?.includes(key)) {
          updateData[key] = value;
        }
      }
    }

    const result = await model.upsert({
      where,
      create: createData,
      update: Object.keys(updateData).length > 0 ? updateData : {},
    });

    return {
      data: result as ModelObject<M['model']>,
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
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  protected override async recordExists(lookupValue: string): Promise<boolean> {
    const model = this.getModel();

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
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const versionField = this.getVersioningConfig().field;
    const primaryKey = this._meta.model.primaryKeys[0];

    // Find the existing record
    const existing = await model.findFirst({
      where: { [this.lookupField]: lookupValue },
    });

    if (!existing) {
      throw new Error(`Record not found: ${lookupValue}`);
    }

    // Update the record with version data and new version number
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: {
        ...versionData,
        [versionField]: newVersion,
      },
    });

    return result as ModelObject<M['model']>;
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
  abstract prisma: PrismaClient;

  /**
   * Whether to use native Prisma aggregations.
   * Set to false to fall back to in-memory computation.
   * Default: true
   */
  protected useNativeAggregation: boolean = true;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Builds the where clause for aggregation queries.
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
      for (const [field, value] of Object.entries(options.filters)) {
        if (typeof value === 'object' && value !== null) {
          // Operator syntax - convert to Prisma format
          const prismaCondition: Record<string, unknown> = {};
          for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
            switch (op) {
              case 'eq':
                prismaCondition.equals = opValue;
                break;
              case 'ne':
                prismaCondition.not = opValue;
                break;
              case 'gt':
                prismaCondition.gt = opValue;
                break;
              case 'gte':
                prismaCondition.gte = opValue;
                break;
              case 'lt':
                prismaCondition.lt = opValue;
                break;
              case 'lte':
                prismaCondition.lte = opValue;
                break;
              case 'in':
                prismaCondition.in = opValue;
                break;
              case 'nin':
                prismaCondition.notIn = opValue;
                break;
              default:
                prismaCondition[op] = opValue;
            }
          }
          where[field] = prismaCondition;
        } else {
          // Simple equality
          where[field] = value;
        }
      }
    }

    return where;
  }

  override async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const model = this.getModel();
    const where = await this.buildAggregateWhere(options);

    // Fall back to in-memory computation if native aggregation is disabled
    // or if there are HAVING clauses (not supported by Prisma aggregate)
    if (!this.useNativeAggregation || options.having) {
      const records = await model.findMany({ where });
      return computeAggregations(records as Record<string, unknown>[], options);
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
    model: PrismaModelOperations,
    where: Record<string, unknown>,
    options: AggregateOptions
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

    // Execute native aggregation
    const modelName = getModelName(this._meta.model.tableName);
    const prismaModel = this.prisma[modelName] as unknown as {
      aggregate: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    try {
      const result = await prismaModel.aggregate(aggregateArgs);

      // Map results to our format
      if (result._count !== undefined) {
        values.count = typeof result._count === 'object'
          ? (result._count as { _all?: number })._all ?? 0
          : result._count as number;
      }

      if (result._sum && grouped.sum.length) {
        for (const field of grouped.sum) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`sum${camelField}`] = ((result._sum as Record<string, unknown>)[field] as number) ?? 0;
        }
      }

      if (result._avg && grouped.avg.length) {
        for (const field of grouped.avg) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`avg${camelField}`] = ((result._avg as Record<string, unknown>)[field] as number) ?? 0;
        }
      }

      if (result._min && grouped.min.length) {
        for (const field of grouped.min) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`min${camelField}`] = (result._min as Record<string, unknown>)[field] as number | null;
        }
      }

      if (result._max && grouped.max.length) {
        for (const field of grouped.max) {
          const camelField = field.charAt(0).toUpperCase() + field.slice(1);
          values[`max${camelField}`] = (result._max as Record<string, unknown>)[field] as number | null;
        }
      }

      return { values, groups: [] };
    } catch (error) {
      // Fall back to in-memory computation if native aggregation fails
      const records = await model.findMany({ where });
      return computeAggregations(records as Record<string, unknown>[], options);
    }
  }

  /**
   * Performs aggregation with groupBy using native Prisma groupBy.
   */
  protected async aggregateWithGroupBy(
    model: PrismaModelOperations,
    where: Record<string, unknown>,
    options: AggregateOptions
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

    // Execute native groupBy
    const modelName = getModelName(this._meta.model.tableName);
    const prismaModel = this.prisma[modelName] as unknown as {
      groupBy: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
    };

    try {
      const results = await prismaModel.groupBy(groupByArgs);

      // Map results to our format
      const groups: Array<{ key: Record<string, unknown>; values: Record<string, number | null> }> = results.map(result => {
        const key: Record<string, unknown> = {};
        const groupValues: Record<string, number | null> = {};

        // Add group key values
        for (const field of options.groupBy!) {
          key[field] = result[field];
        }

        // Add count
        groupValues.count = typeof result._count === 'object'
          ? (result._count as { _all?: number })._all ?? 0
          : (result._count as number) ?? 0;

        // Add aggregations
        if (result._sum && grouped.sum.length) {
          for (const field of grouped.sum) {
            const camelField = field.charAt(0).toUpperCase() + field.slice(1);
            groupValues[`sum${camelField}`] = ((result._sum as Record<string, unknown>)[field] as number) ?? 0;
          }
        }

        if (result._avg && grouped.avg.length) {
          for (const field of grouped.avg) {
            const camelField = field.charAt(0).toUpperCase() + field.slice(1);
            groupValues[`avg${camelField}`] = ((result._avg as Record<string, unknown>)[field] as number) ?? 0;
          }
        }

        if (result._min && grouped.min.length) {
          for (const field of grouped.min) {
            const camelField = field.charAt(0).toUpperCase() + field.slice(1);
            groupValues[`min${camelField}`] = (result._min as Record<string, unknown>)[field] as number | null;
          }
        }

        if (result._max && grouped.max.length) {
          for (const field of grouped.max) {
            const camelField = field.charAt(0).toUpperCase() + field.slice(1);
            groupValues[`max${camelField}`] = (result._max as Record<string, unknown>)[field] as number | null;
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
      return computeAggregations(records as Record<string, unknown>[], options);
    }
  }
}
