/**
 * Prisma adapter helpers: types, model resolution, relation loading, query utils.
 *
 * **Edge runtime note:** Prisma Client does not support all edge runtimes
 * natively. For Cloudflare Workers, use the Prisma Accelerate or Data Proxy
 * driver. Module-level caches in this file (e.g. `modelNameCache`,
 * `fieldInfoCache`) are per-isolate and will reset on cold starts.
 */
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  FilterCondition,
  IncludeOptions,
  RelationConfig,
} from '../../core/types';
import { inlineSingular, levenshteinDistance } from './pluralize';

// Type for Prisma model operations
export interface PrismaModelOperations {
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
export type PrismaClient = Record<string, PrismaModelOperations> & {
  $transaction: <T>(fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
};

/**
 * Coerces a value to the appropriate type for Prisma.
 * Converts numeric strings to numbers, boolean strings to booleans, etc.
 */
export function coerceValue(value: unknown): unknown {
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
export function buildPrismaWhere(filters: FilterCondition[]): Record<string, unknown> {
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
 * Bounded to 500 entries to prevent unbounded growth in pathological cases.
 */
const MODEL_NAME_CACHE_MAX = 500;
const modelNameCache = new Map<string, string>();

function cacheModelName(key: string, value: string): void {
  if (modelNameCache.size >= MODEL_NAME_CACHE_MAX) {
    // Evict oldest entry (first key in Map insertion order)
    const firstKey = modelNameCache.keys().next().value;
    if (firstKey !== undefined) modelNameCache.delete(firstKey);
  }
  modelNameCache.set(key, value);
}

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
 * Converts a plural word to singular.
 * Handles irregular plurals (people→person, children→child, etc.) and
 * common English pluralization patterns automatically.
 */
function pluralToSingular(word: string): string {
  return inlineSingular(word);
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
export function getModelName(tableName: string): string {
  // Check cache first
  const cached = modelNameCache.get(tableName);
  if (cached) {
    return cached;
  }

  // Check custom mappings
  const custom = customModelMappings.get(tableName.toLowerCase());
  if (custom) {
    cacheModelName(tableName, custom);
    return custom;
  }

  // Convert snake_case or kebab-case to camelCase
  let name = tableName
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());

  // Convert plural to singular
  name = pluralToSingular(name);

  // Cache the result
  cacheModelName(tableName, name);

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
export function getPrismaModel(prisma: PrismaClient, tableName: string): PrismaModelOperations {
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
export async function loadPrismaRelation<T extends Record<string, unknown>>(
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
export async function loadPrismaRelations<T extends Record<string, unknown>, M extends MetaInput>(
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
export async function batchLoadPrismaRelations<T extends Record<string, unknown>, M extends MetaInput>(
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
export interface PrismaQueryOptions {
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
export interface PrismaQueryResult {
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
export async function executePrismaQuery(options: PrismaQueryOptions): Promise<PrismaQueryResult> {
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
export function buildPaginatedResult<T>(
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
