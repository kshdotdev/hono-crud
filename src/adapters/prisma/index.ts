import type { Env } from 'hono';
import { distance as levenshteinDistance } from 'fastest-levenshtein';
import pluralize from 'pluralize';
import { CreateEndpoint } from '../../endpoints/create.js';
import { ReadEndpoint } from '../../endpoints/read.js';
import { UpdateEndpoint } from '../../endpoints/update.js';
import { DeleteEndpoint } from '../../endpoints/delete.js';
import { ListEndpoint } from '../../endpoints/list.js';
import { RestoreEndpoint } from '../../endpoints/restore.js';
import { UpsertEndpoint } from '../../endpoints/upsert.js';
import { BatchCreateEndpoint } from '../../endpoints/batch-create.js';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update.js';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete.js';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore.js';
import { BatchUpsertEndpoint } from '../../endpoints/batch-upsert.js';
import {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from '../../endpoints/version-history.js';
import { AggregateEndpoint, computeAggregations } from '../../endpoints/aggregate.js';
import { SearchEndpoint, searchInMemory } from '../../endpoints/search.js';
import { ExportEndpoint } from '../../endpoints/export.js';
import { ImportEndpoint } from '../../endpoints/import.js';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  FilterCondition,
  SearchOptions,
  SearchResult,
  AggregateOptions,
  AggregateResult,
  AggregateField,
  IncludeOptions,
  RelationConfig,
} from '../../core/types.js';
import type { ModelObject } from '../../endpoints/types.js';

// Type for Prisma model operations
interface PrismaModelOperations {
  create: (args: { data: unknown }) => Promise<unknown>;
  findUnique: (args: { where: unknown }) => Promise<unknown>;
  findFirst: (args: { where: unknown }) => Promise<unknown>;
  findMany: (args: {
    where?: unknown;
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }) => Promise<unknown[]>;
  update: (args: { where: unknown; data: unknown }) => Promise<unknown>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
  delete: (args: { where: unknown }) => Promise<unknown>;
  deleteMany: (args: { where: unknown }) => Promise<{ count: number }>;
  count: (args?: { where?: unknown }) => Promise<number>;
  upsert: (args: { where: unknown; create: unknown; update: unknown }) => Promise<unknown>;
  createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
}

// Type for Prisma client - we use a Record type with explicit model access
// Dynamic model access requires flexibility since model names are determined at runtime
type PrismaClient = Record<string, PrismaModelOperations> & {
  $transaction: <T>(fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
};

/**
 * Coerces a value to the appropriate type for Prisma.
 * Converts numeric strings to numbers, boolean strings to booleans, etc.
 */
function coerceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Check for numeric string
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    // Check for boolean string
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * Converts filter conditions to Prisma where clause.
 */
function buildPrismaWhere(filters: FilterCondition[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const filter of filters) {
    const value = coerceValue(filter.value);

    switch (filter.operator) {
      case 'eq':
        where[filter.field] = value;
        break;
      case 'ne':
        where[filter.field] = { not: value };
        break;
      case 'gt':
        where[filter.field] = { gt: value };
        break;
      case 'gte':
        where[filter.field] = { gte: value };
        break;
      case 'lt':
        where[filter.field] = { lt: value };
        break;
      case 'lte':
        where[filter.field] = { lte: value };
        break;
      case 'in': {
        const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
        where[filter.field] = { in: arr.map(coerceValue) };
        break;
      }
      case 'nin': {
        const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
        where[filter.field] = { notIn: arr.map(coerceValue) };
        break;
      }
      case 'like':
        where[filter.field] = { contains: String(filter.value).replace(/%/g, '') };
        break;
      case 'ilike':
        where[filter.field] = {
          contains: String(filter.value).replace(/%/g, ''),
          mode: 'insensitive',
        };
        break;
      case 'null':
        where[filter.field] = filter.value ? null : { not: null };
        break;
      case 'between': {
        const [min, max] = filter.value as [unknown, unknown];
        where[filter.field] = { gte: coerceValue(min), lte: coerceValue(max) };
        break;
      }
    }
  }

  return where;
}

// ============================================================================
// Model Name Resolution
// ============================================================================

/**
 * Cache for model name conversions to avoid repeated string manipulation.
 */
const modelNameCache = new Map<string, string>();

/**
 * Custom model name mappings for irregular cases.
 * Users can register mappings via `registerPrismaModelMapping()`.
 */
const customModelMappings = new Map<string, string>();

/**
 * Registers a custom table name to Prisma model name mapping.
 * Use this for irregular cases where automatic conversion fails.
 *
 * @param tableName - The table name used in your model meta
 * @param modelName - The Prisma model name (camelCase, singular)
 *
 * @example
 * ```ts
 * // Register custom mapping for irregular plural
 * registerPrismaModelMapping('people', 'person');
 * registerPrismaModelMapping('user_addresses', 'userAddress');
 * ```
 */
export function registerPrismaModelMapping(tableName: string, modelName: string): void {
  customModelMappings.set(tableName.toLowerCase(), modelName);
  // Also clear cache entry if it exists
  modelNameCache.delete(tableName);
}

/**
 * Registers multiple custom table name to Prisma model name mappings.
 *
 * @param mappings - Object with table names as keys and model names as values
 *
 * @example
 * ```ts
 * registerPrismaModelMappings({
 *   'people': 'person',
 *   'user_addresses': 'userAddress',
 *   'order_items': 'orderItem',
 * });
 * ```
 */
export function registerPrismaModelMappings(mappings: Record<string, string>): void {
  for (const [tableName, modelName] of Object.entries(mappings)) {
    registerPrismaModelMapping(tableName, modelName);
  }
}

/**
 * Clears all custom model name mappings and cache.
 * Useful for testing or reconfiguration.
 */
export function clearPrismaModelMappings(): void {
  customModelMappings.clear();
  modelNameCache.clear();
}

/**
 * Converts a plural word to singular using the `pluralize` library.
 * Handles irregular plurals (people→person, children→child, etc.) and
 * common English pluralization patterns automatically.
 *
 * Uses the `pluralize` library for runtime-agnostic pluralization.
 */
function pluralToSingular(word: string): string {
  return pluralize.singular(word);
}

/**
 * Gets the model name for Prisma from the table name.
 * Prisma uses singular camelCase model names (e.g., 'users' -> 'user').
 *
 * Uses caching for performance and supports custom mappings for irregular cases.
 *
 * @param tableName - The table name (e.g., 'users', 'user_profiles', 'order-items')
 * @returns The Prisma model name (e.g., 'user', 'userProfile', 'orderItem')
 */
function getModelName(tableName: string): string {
  // Check cache first
  const cached = modelNameCache.get(tableName);
  if (cached) {
    return cached;
  }

  // Check custom mappings
  const custom = customModelMappings.get(tableName.toLowerCase());
  if (custom) {
    modelNameCache.set(tableName, custom);
    return custom;
  }

  // Convert snake_case or kebab-case to camelCase
  let name = tableName
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());

  // Convert plural to singular
  name = pluralToSingular(name);

  // Cache the result
  modelNameCache.set(tableName, name);

  return name;
}

/**
 * Gets available model names from a Prisma client for error suggestions.
 */
function getAvailablePrismaModels(prisma: PrismaClient): string[] {
  const models: string[] = [];
  for (const key of Object.keys(prisma)) {
    // Skip internal Prisma properties (start with $ or _)
    if (key.startsWith('$') || key.startsWith('_')) {
      continue;
    }
    const value = prisma[key];
    // Check if it looks like a model (has create method)
    if (value && typeof value === 'object' && 'create' in value) {
      models.push(key);
    }
  }
  return models;
}

/**
 * Finds similar model names for error suggestions using Levenshtein distance.
 * Uses the `fastest-levenshtein` library for runtime-agnostic string comparison.
 */
function findSimilarModelNames(target: string, available: string[], maxSuggestions = 3): string[] {
  if (available.length === 0) return [];

  const targetLower = target.toLowerCase();
  const scored = available
    .map(name => ({
      name,
      distance: levenshteinDistance(targetLower, name.toLowerCase()),
    }))
    .filter(item => item.distance <= Math.max(3, target.length / 2))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions);

  return scored.map(item => item.name);
}

/**
 * Gets a Prisma model from the client with validation.
 * Throws an error with helpful suggestions if the model is not found.
 *
 * @param prisma - The Prisma client
 * @param tableName - The table name from the model meta
 * @returns The Prisma model operations
 * @throws Error if the model is not found in the Prisma client
 */
function getPrismaModel(prisma: PrismaClient, tableName: string): PrismaModelOperations {
  const modelName = getModelName(tableName);
  const model = prisma[modelName];

  if (!model || typeof model.create !== 'function') {
    const availableModels = getAvailablePrismaModels(prisma);
    const suggestions = findSimilarModelNames(modelName, availableModels);

    let errorMessage = `Model '${modelName}' not found in Prisma client. ` +
      `Table name: '${tableName}'. `;

    if (suggestions.length > 0) {
      errorMessage += `Did you mean: ${suggestions.map(s => `'${s}'`).join(', ')}? `;
    }

    if (availableModels.length > 0 && availableModels.length <= 10) {
      errorMessage += `Available models: ${availableModels.join(', ')}. `;
    }

    errorMessage += `You can register a custom mapping with: registerPrismaModelMapping('${tableName}', 'yourModelName')`;

    throw new Error(errorMessage);
  }

  return model;
}

/**
 * Loads a single relation for an item.
 */
async function loadPrismaRelation<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  item: T,
  relationName: string,
  relationConfig: RelationConfig
): Promise<T> {
  const relatedModelName = getModelName(relationConfig.model);
  const relatedModel = prisma[relatedModelName];

  if (!relatedModel) {
    // Can't load relation without the related model
    return item;
  }

  switch (relationConfig.type) {
    case 'hasOne': {
      const localKey = relationConfig.localKey || 'id';
      const localValue = item[localKey];
      if (localValue === undefined || localValue === null) {
        return { ...item, [relationName]: null };
      }
      const result = await relatedModel.findFirst({
        where: { [relationConfig.foreignKey]: localValue },
      });
      return { ...item, [relationName]: result || null };
    }
    case 'hasMany': {
      const localKey = relationConfig.localKey || 'id';
      const localValue = item[localKey];
      if (localValue === undefined || localValue === null) {
        return { ...item, [relationName]: [] };
      }
      const results = await relatedModel.findMany({
        where: { [relationConfig.foreignKey]: localValue },
      });
      return { ...item, [relationName]: results };
    }
    case 'belongsTo': {
      // For belongsTo, the foreign key is on the current item
      const foreignValue = item[relationConfig.foreignKey];
      if (foreignValue === undefined || foreignValue === null) {
        return { ...item, [relationName]: null };
      }
      const localKey = relationConfig.localKey || 'id';
      const result = await relatedModel.findFirst({
        where: { [localKey]: foreignValue },
      });
      return { ...item, [relationName]: result || null };
    }
    default:
      return item;
  }
}

/**
 * Loads all requested relations for an item.
 * Note: For multiple items, use `batchLoadPrismaRelations` to avoid N+1 queries.
 */
async function loadPrismaRelations<T extends Record<string, unknown>, M extends MetaInput>(
  prisma: PrismaClient,
  item: T,
  meta: M,
  includeOptions?: IncludeOptions
): Promise<T> {
  if (!includeOptions?.relations?.length || !meta.model.relations) {
    return item;
  }

  let result = { ...item } as T;

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName];
    if (relationConfig) {
      result = await loadPrismaRelation(prisma, result, relationName, relationConfig);
    }
  }

  return result;
}

/**
 * Batch loads relations for multiple items to avoid N+1 queries.
 * Instead of N queries per relation, this uses 1 query per relation using `in` operator.
 */
async function batchLoadPrismaRelations<T extends Record<string, unknown>, M extends MetaInput>(
  prisma: PrismaClient,
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
    const relationConfig = meta.model.relations[relationName];
    if (!relationConfig) {
      continue;
    }

    const relatedModelName = getModelName(relationConfig.model);
    const relatedModel = prisma[relatedModelName];

    if (!relatedModel) {
      continue;
    }

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
        const relatedRecords = await relatedModel.findMany({
          where: { [relationConfig.foreignKey]: { in: localValues } },
        });

        // Group related records by foreign key
        const recordsByForeignKey = new Map<unknown, Record<string, unknown>[]>();
        for (const record of relatedRecords as Record<string, unknown>[]) {
          const foreignVal = record[relationConfig.foreignKey];
          if (!recordsByForeignKey.has(foreignVal)) {
            recordsByForeignKey.set(foreignVal, []);
          }
          recordsByForeignKey.get(foreignVal)!.push(record);
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
        const relatedRecords = await relatedModel.findMany({
          where: { [refLocalKey]: { in: foreignValues } },
        });

        // Create a map for quick lookup
        const recordsByLocalKey = new Map<unknown, Record<string, unknown>>();
        for (const record of relatedRecords as Record<string, unknown>[]) {
          const localVal = record[refLocalKey];
          recordsByLocalKey.set(localVal, record);
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
 * Options for executing a Prisma list query.
 */
interface PrismaQueryOptions {
  /** The Prisma model operations */
  model: PrismaModelOperations;
  /** List filters from the request */
  filters: ListFilters;
  /** Search fields for text search (optional) */
  searchFields?: string[];
  /** Soft delete configuration (optional) */
  softDeleteConfig?: { enabled: boolean; field: string };
  /** Default items per page */
  defaultPerPage?: number;
  /** Additional WHERE conditions to merge (optional) */
  additionalWhere?: Record<string, unknown>;
}

/**
 * Result of a Prisma list query.
 */
interface PrismaQueryResult {
  /** The fetched records */
  records: unknown[];
  /** The WHERE clause used */
  where: Record<string, unknown>;
  /** Total count of matching records */
  totalCount: number;
  /** Current page number */
  page: number;
  /** Items per page */
  perPage: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Executes a common Prisma list query with filtering, sorting, and pagination.
 * This helper reduces code duplication across List, Search, and Export endpoints.
 *
 * @param options - Query configuration options
 * @returns Query result with records and pagination info
 */
async function executePrismaQuery(options: PrismaQueryOptions): Promise<PrismaQueryResult> {
  const {
    model,
    filters,
    searchFields = [],
    softDeleteConfig,
    defaultPerPage = 20,
    additionalWhere = {},
  } = options;

  // Build base WHERE clause from filters
  let where: Record<string, unknown> = {
    ...buildPrismaWhere(filters.filters),
    ...additionalWhere,
  };

  // Apply soft delete filter (exclude deleted records by default)
  if (softDeleteConfig?.enabled) {
    const { withDeleted, onlyDeleted } = filters.options;
    if (onlyDeleted) {
      // Show only deleted records
      where[softDeleteConfig.field] = { not: null };
    } else if (!withDeleted) {
      // Exclude deleted records (default)
      where[softDeleteConfig.field] = null;
    }
    // If withDeleted is true, don't add any filter
  }

  // Apply search if search fields are configured
  if (filters.options.search && searchFields.length > 0) {
    const searchConditions = searchFields.map((field) => ({
      [field]: { contains: filters.options.search, mode: 'insensitive' },
    }));
    where = {
      ...where,
      OR: searchConditions,
    };
  }

  // Get total count
  const totalCount = await model.count({ where });

  // Build orderBy
  let orderBy: Record<string, string> | undefined;
  if (filters.options.order_by) {
    orderBy = {
      [filters.options.order_by]: filters.options.order_by_direction || 'asc',
    };
  }

  // Apply pagination
  const page = filters.options.page || 1;
  const perPage = filters.options.per_page || defaultPerPage;

  // Execute query
  const records = await model.findMany({
    where,
    orderBy,
    skip: (page - 1) * perPage,
    take: perPage,
  });

  const totalPages = Math.ceil(totalCount / perPage);

  return {
    records,
    where,
    totalCount,
    page,
    perPage,
    totalPages,
  };
}

/**
 * Builds a PaginatedResult from query results.
 */
function buildPaginatedResult<T>(
  items: T[],
  queryResult: PrismaQueryResult
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
 * Prisma Create endpoint.
 */
export abstract class PrismaCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async create(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
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
}

/**
 * Prisma Read endpoint.
 */
export abstract class PrismaReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    const result = await model.findFirst({ where });

    if (!result) {
      return null;
    }

    // Load relations if requested
    const itemWithRelations = await loadPrismaRelations(
      this.prisma,
      result as Record<string, unknown>,
      this._meta,
      includeOptions
    );

    return itemWithRelations as ModelObject<M['model']>;
  }
}

/**
 * Prisma Update endpoint.
 */
export abstract class PrismaUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpdateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();

    // First find the record
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    // Then update it using the primary key
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data,
    });

    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Delete endpoint.
 */
export abstract class PrismaDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends DeleteEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Finds a record without deleting it (for constraint checks).
   */
  override async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Exclude already-deleted records for soft delete
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const result = await model.findFirst({ where });
    return result as ModelObject<M['model']> | null;
  }

  override async delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build where clause
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Exclude already-deleted records for soft delete
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    const primaryKey = this._meta.model.primaryKeys[0];
    const primaryKeyValue = (existing as Record<string, unknown>)[primaryKey];

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      const result = await model.update({
        where: { [primaryKey]: primaryKeyValue },
        data: { [softDeleteConfig.field]: new Date() },
      });
      return result as ModelObject<M['model']>;
    } else {
      // Hard delete: actually remove the record
      const result = await model.delete({
        where: { [primaryKey]: primaryKeyValue },
      });
      return result as ModelObject<M['model']>;
    }
  }
}

/**
 * Prisma List endpoint with filtering, sorting, and pagination.
 */
export abstract class PrismaListEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
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
 * Prisma Search endpoint.
 * Provides full-text search with relevance scoring and highlighting.
 *
 * Uses Prisma's `contains` with `mode: 'insensitive'` for case-insensitive search,
 * then scores and highlights results in memory.
 *
 * Features:
 * - Case-insensitive search using Prisma's contains
 * - In-memory relevance scoring with field weights
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact)
 * - Highlighted snippets
 * - Combined with standard list filters
 * - Soft delete filtering (excludes deleted records by default)
 *
 * @example
 * ```ts
 * class UserSearch extends PrismaSearchEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Users'], summary: 'Search users' };
 *
 *   protected searchFields = ['name', 'email', 'bio'];
 *   protected fieldWeights = { name: 2.0, bio: 1.0 };
 *   protected filterFields = ['status'];
 * }
 * ```
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
 *
 * @example
 * ```ts
 * class UserUpsert extends PrismaUpsertEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Users'], summary: 'Upsert user' };
 *
 *   // Use native Prisma upsert for atomic operation
 *   protected useNativeUpsert = true;
 *
 *   // Upsert by email
 *   protected upsertKeys = ['email'];
 * }
 * ```
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
   *
   * Uses Prisma's built-in `upsert` method for atomic create-or-update.
   *
   * Note: This method cannot accurately determine if the record was created or updated.
   * The `created` flag is set to `false` by default.
   */
  protected override async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
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
 * Prisma Batch Upsert endpoint.
 * Creates or updates multiple records in a single request.
 *
 * Supports native Prisma upsert via `useNativeUpsert = true` for atomic operations.
 * Note: Prisma doesn't have a native batch upsert, so this uses individual upsert calls
 * within a transaction for atomicity.
 *
 * @example
 * ```ts
 * class ProductBatchUpsert extends PrismaBatchUpsertEndpoint<Env, typeof productMeta> {
 *   _meta = productMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Products'], summary: 'Batch upsert products' };
 *
 *   // Use native Prisma upsert for atomic operation
 *   protected useNativeUpsert = true;
 *
 *   // Upsert by SKU
 *   protected upsertKeys = ['sku'];
 * }
 * ```
 */
export abstract class PrismaBatchUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpsertEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = true;

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
   * Performs native Prisma batch upsert using individual upsert calls in a transaction.
   *
   * Note: Prisma doesn't have a native batch upsert method, so this executes
   * individual upsert operations. When useTransaction is true (default), all
   * operations are wrapped in a transaction for atomicity.
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

    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    const executeUpserts = async (prismaClient: PrismaClient) => {
      const model = prismaClient[getModelName(this._meta.model.tableName)];
      const results: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }> = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
          // Build where clause from upsert keys
          const where: Record<string, unknown> = {};
          for (const key of upsertKeys) {
            const value = (item as Record<string, unknown>)[key];
            if (value !== undefined) {
              where[key] = value;
            }
          }

          // Build create data with generated UUID
          const createData = {
            ...item,
            [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
          };

          // Build update data - exclude upsert keys and primary key, filter create-only fields
          const updateData: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(item)) {
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

          results.push({
            data: result as ModelObject<M['model']>,
            created: false, // Cannot determine with native upsert
            index: i,
          });
        } catch (error) {
          if (this.continueOnError) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            throw error;
          }
        }
      }

      return { results, errors };
    };

    let outcome: { results: typeof items extends unknown[] ? Array<{ data: ModelObject<M['model']>; created: boolean; index: number }> : never; errors: Array<{ index: number; error: string }> };

    if (this.useTransaction) {
      outcome = await this.prisma.$transaction(executeUpserts);
    } else {
      outcome = await executeUpserts(this.prisma);
    }

    const result: {
      items: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }>;
      createdCount: number;
      updatedCount: number;
      totalCount: number;
      errors?: Array<{ index: number; error: string }>;
    } = {
      items: outcome.results,
      createdCount: 0, // Cannot determine with native upsert
      updatedCount: outcome.results.length, // Assume all were updates (conservative)
      totalCount: outcome.results.length,
    };

    if (outcome.errors.length > 0) {
      result.errors = outcome.errors;
    }

    return result;
  }
}

/**
 * Prisma Restore endpoint for un-deleting soft-deleted records.
 *
 * Only works with models that have `softDelete` enabled.
 * Sets the deletion timestamp back to null.
 */
export abstract class PrismaRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RestoreEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build where clause
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      // Only restore records that are actually deleted
      [softDeleteConfig.field]: { not: null },
      ...additionalFilters,
    };

    // Find the deleted record first
    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    // Then restore it by setting deletedAt to null
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: { [softDeleteConfig.field]: null },
    });

    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Batch Create endpoint.
 * Creates multiple records in a single request.
 */
export abstract class PrismaBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchCreateEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate IDs for items that don't have them
    const records = items.map((item) => ({
      ...item,
      [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    }));

    // Prisma's createMany doesn't return the created records, so we need to use
    // individual creates or a transaction with creates
    const created: ModelObject<M['model']>[] = [];

    await this.prisma.$transaction(async (tx) => {
      const txModel = tx[getModelName(this._meta.model.tableName)];
      for (const record of records) {
        const result = await txModel.create({ data: record });
        created.push(result as ModelObject<M['model']>);
      }
    });

    return created;
  }
}

/**
 * Prisma Batch Update endpoint.
 * Updates multiple records in a single request.
 *
 * Supports soft delete filtering (cannot update deleted records).
 */
export abstract class PrismaBatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpdateEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Extract all IDs for batch lookup
    const allIds = items.map(item => item.id);

    // Build where clause for batch lookup
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: allIds },
    };

    // Filter out soft-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    // Batch lookup: Find all existing records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Process each update
    for (const item of items) {
      const existing = existingMap.get(item.id);
      if (!existing) {
        notFound.push(item.id);
        continue;
      }

      // Update using primary key
      const result = await model.update({
        where: { [primaryKey]: existing[primaryKey] },
        data: item.data as Record<string, unknown>,
      });

      updated.push(result as ModelObject<M['model']>);
    }

    return { updated, notFound };
  }
}

/**
 * Prisma Batch Delete endpoint.
 * Deletes multiple records in a single request.
 *
 * Supports soft delete when the model has `softDelete` configured.
 */
export abstract class PrismaBatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchDeleteEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const deleted: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Build where clause for batch lookup
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: ids },
    };

    // For soft delete, exclude already-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    // Batch lookup: Find all existing records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Determine which IDs were not found
    for (const id of ids) {
      if (!existingMap.has(id)) {
        notFound.push(id);
      }
    }

    // Process deletions for existing records
    for (const id of ids) {
      const existing = existingMap.get(id);
      if (!existing) {
        continue; // Already added to notFound
      }

      if (softDeleteConfig.enabled) {
        // Soft delete: set the deletion timestamp
        const result = await model.update({
          where: { [primaryKey]: existing[primaryKey] },
          data: { [softDeleteConfig.field]: new Date() },
        });
        deleted.push(result as ModelObject<M['model']>);
      } else {
        // Hard delete: actually remove the record
        const result = await model.delete({
          where: { [primaryKey]: existing[primaryKey] },
        });
        deleted.push(result as ModelObject<M['model']>);
      }
    }

    return { deleted, notFound };
  }
}

/**
 * Prisma Batch Restore endpoint for un-deleting soft-deleted records.
 *
 * Only works with models that have `softDelete` enabled.
 */
export abstract class PrismaBatchRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchRestoreEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const restored: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Build where clause - only find records that are actually deleted
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: ids },
      [softDeleteConfig.field]: { not: null },
    };

    // Batch lookup: Find all deleted records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Process restores
    for (const id of ids) {
      const existing = existingMap.get(id);
      if (!existing) {
        notFound.push(id);
        continue;
      }

      // Restore by setting deletedAt to null
      const result = await model.update({
        where: { [primaryKey]: existing[primaryKey] },
        data: { [softDeleteConfig.field]: null },
      });

      restored.push(result as ModelObject<M['model']>);
    }

    return { restored, notFound };
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
    // Note: Prisma uses dynamic model access, so we need to use the prisma client directly
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
