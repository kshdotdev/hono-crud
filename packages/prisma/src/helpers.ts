/**
 * Prisma adapter helpers: types, model resolution, relation loading, query utils.
 *
 * **Edge runtime note:** Prisma Client does not support all edge runtimes
 * natively. For Cloudflare Workers, use the Prisma Accelerate or Data Proxy
 * driver. Module-level caches in this file (e.g. `modelNameCache`,
 * `fieldInfoCache`) are per-isolate and will reset on cold starts.
 */
import type {
  FilterCondition,
  IncludeOptions,
  ListFilters,
  MetaInput,
  PaginatedResult,
  RelationLoaderAdapter,
} from 'hono-crud/internal';
import {
  assertNever,
  batchLoadRelations,
  decodeCursor,
  loadRelationsForItem,
} from 'hono-crud/internal';
import { inlineSingular, levenshteinDistance } from './pluralize';

/**
 * Structural shape of a Prisma model delegate, generic over the row type `Row`
 * a query resolves to (derived from the consumer's Zod schema as
 * `ModelObject<M['model']>`). Read/write operations return `Row`, so endpoint
 * results come back typed without per-call `as ModelObject` casts. Defaults to
 * `Record<string, unknown>` for dynamic/relation access where the row type is
 * not statically known.
 */
export interface PrismaModelOperations<Row = Record<string, unknown>> {
  create: (args: { data: unknown }) => Promise<Row>;
  findUnique: (args: { where: unknown }) => Promise<Row | null>;
  findFirst: (args: { where: unknown }) => Promise<Row | null>;
  findMany: (args: {
    where?: unknown;
    orderBy?: unknown;
    skip?: number;
    take?: number;
    cursor?: Record<string, unknown>;
  }) => Promise<Row[]>;
  update: (args: { where: unknown; data: unknown }) => Promise<Row>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
  delete: (args: { where: unknown }) => Promise<Row>;
  deleteMany: (args: { where: unknown }) => Promise<{ count: number }>;
  count: (args?: { where?: unknown }) => Promise<number>;
  upsert: (args: { where: unknown; create: unknown; update: unknown }) => Promise<Row>;
  createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
  /**
   * Native Prisma aggregate. The result shape (`_count`/`_sum`/`_avg`/...) is
   * delegate- and args-specific, so it is typed as a generic record the caller
   * narrows.
   */
  aggregate: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Native Prisma groupBy. Returns one record per group (caller narrows). */
  groupBy: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}

// Public Prisma clients do not expose a string index signature, even though
// model delegates are available as runtime properties. Keep the accepted
// client shape broad and centralize dynamic access behind helpers.
export type PrismaClient = object & {
  $transaction?: <T>(fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
};

function getClientProperty(prisma: PrismaClient, key: string): unknown {
  return (prisma as unknown as Record<string, unknown>)[key];
}

function isPrismaModelOperations<Row = Record<string, unknown>>(
  value: unknown,
): value is PrismaModelOperations<Row> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'create' in value &&
    typeof (value as { create?: unknown }).create === 'function'
  );
}

export function getPrismaModelByName<Row = Record<string, unknown>>(
  prisma: PrismaClient,
  modelName: string,
): PrismaModelOperations<Row> | undefined {
  const model = getClientProperty(prisma, modelName);
  return isPrismaModelOperations<Row>(model) ? model : undefined;
}

export function getPrismaTransaction(
  prisma: PrismaClient,
): NonNullable<PrismaClient['$transaction']> {
  if (typeof prisma.$transaction !== 'function') {
    throw new Error('Prisma client does not support $transaction');
  }
  return prisma.$transaction.bind(prisma);
}

/**
 * Coerces a value to the appropriate type for Prisma.
 * Converts numeric strings to numbers, boolean strings to booleans, etc.
 */
export function coerceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Check for numeric string
    if (/^-?\d+$/.test(value)) {
      return Number.parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return Number.parseFloat(value);
    }
    // Check for boolean string
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * Converts a single filter condition to its Prisma where value (the right-hand
 * side keyed by `filter.field`). Exhaustive over `FilterOperator` so a new
 * operator must be handled here; the `assertNever` default is unreachable at
 * runtime because operators are validated upstream (`parseFilterValue` /
 * allow-listed query parsing) before reaching an adapter.
 */
function filterToPrismaValue(filter: FilterCondition): unknown {
  const value = coerceValue(filter.value);

  switch (filter.operator) {
    case 'eq':
      return value;
    case 'ne':
      return { not: value };
    case 'gt':
      return { gt: value };
    case 'gte':
      return { gte: value };
    case 'lt':
      return { lt: value };
    case 'lte':
      return { lte: value };
    case 'in': {
      const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
      return { in: arr.map(coerceValue) };
    }
    case 'nin': {
      const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
      return { notIn: arr.map(coerceValue) };
    }
    case 'like':
      return { contains: escapeLikeWildcards(String(filter.value).replace(/%/g, '')) };
    case 'ilike':
      return {
        contains: escapeLikeWildcards(String(filter.value).replace(/%/g, '')),
        mode: 'insensitive',
      };
    case 'null':
      return filter.value ? null : { not: null };
    case 'between': {
      const [min, max] = filter.value as [unknown, unknown];
      return { gte: coerceValue(min), lte: coerceValue(max) };
    }
    default:
      return assertNever(filter.operator);
  }
}

/**
 * Converts filter conditions to a Prisma where clause.
 *
 * Multiple conditions on the SAME field (e.g. `views[gte]` + `views[lte]`, which
 * `parseListFilters` emits as two separate `FilterCondition`s) must be ANDed,
 * not overwritten. A field with a single condition is keyed directly; a field
 * with two or more conditions emits each into a top-level `AND: [...]` array
 * (Prisma combines top-level `AND` entries conjunctively) so none is lost.
 */
export function buildPrismaWhere(filters: FilterCondition[]): Record<string, unknown> {
  // Preserve input order while grouping every condition by its field.
  const byField = new Map<string, unknown[]>();
  for (const filter of filters) {
    const conditions = byField.get(filter.field) ?? [];
    conditions.push(filterToPrismaValue(filter));
    byField.set(filter.field, conditions);
  }

  const where: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  for (const [field, conditions] of byField) {
    if (conditions.length === 1) {
      where[field] = conditions[0];
    } else {
      for (const condition of conditions) {
        and.push({ [field]: condition });
      }
    }
  }

  if (and.length > 0) {
    where.AND = and;
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
 * Gets the model name for Prisma from the table name.
 * Prisma uses singular camelCase model names (e.g., 'users' -> 'user').
 *
 * Uses caching for performance and supports custom mappings for irregular cases.
 *
 * @param tableName - The table name (e.g., 'users', 'user_profiles', 'order-items')
 * @returns The Prisma model name (e.g., 'user', 'userProfile', 'orderItem')
 */
export async function getModelName(tableName: string): Promise<string> {
  const cached = modelNameCache.get(tableName);
  if (cached) {
    return cached;
  }

  const custom = customModelMappings.get(tableName.toLowerCase());
  if (custom) {
    cacheModelName(tableName, custom);
    return custom;
  }

  // snake_case / kebab-case → camelCase, then plural → singular
  let name = tableName
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());
  name = await inlineSingular(name);

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
    const value = getClientProperty(prisma, key);
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
async function findSimilarModelNames(
  target: string,
  available: string[],
  maxSuggestions = 3,
): Promise<string[]> {
  if (available.length === 0) return [];

  const targetLower = target.toLowerCase();
  const scored = await Promise.all(
    available.map(async (name) => ({
      name,
      distance: await levenshteinDistance(targetLower, name.toLowerCase()),
    })),
  );

  return scored
    .filter((item) => item.distance <= Math.max(3, target.length / 2))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map((item) => item.name);
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
export async function getPrismaModel<Row = Record<string, unknown>>(
  prisma: PrismaClient,
  tableName: string,
): Promise<PrismaModelOperations<Row>> {
  const modelName = await getModelName(tableName);
  const model = getPrismaModelByName<Row>(prisma, modelName);

  if (!model) {
    const availableModels = getAvailablePrismaModels(prisma);
    const suggestions = await findSimilarModelNames(modelName, availableModels);

    let errorMessage =
      `Model '${modelName}' not found in Prisma client. ` + `Table name: '${tableName}'. `;

    if (suggestions.length > 0) {
      errorMessage += `Did you mean: ${suggestions.map((s) => `'${s}'`).join(', ')}? `;
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
 * Builds the Prisma relation-loader adapter for the core orchestrator.
 *
 * - `resolveRelation` resolves the related model delegate by name (async because
 *   `getModelName` is async), returning `null` to skip when the model is not
 *   found in the client.
 * - `fetchRelated` issues the one-line `findMany({ where: { [keyField]: { in } } })`
 *   query the batch + single-item loaders share.
 */
function prismaRelationAdapter(prisma: PrismaClient): RelationLoaderAdapter<PrismaModelOperations> {
  return {
    resolveRelation: async (config) =>
      getPrismaModelByName(prisma, await getModelName(config.model)) ?? null,
    fetchRelated: (model, keyField, values) =>
      model.findMany({ where: { [keyField]: { in: values } } }),
  };
}

/**
 * Loads all requested relations for an item.
 * Note: For multiple items, use `batchLoadPrismaRelations` to avoid N+1 queries.
 */
export async function loadPrismaRelations<T extends Record<string, unknown>, M extends MetaInput>(
  prisma: PrismaClient,
  item: T,
  meta: M,
  includeOptions?: IncludeOptions,
): Promise<T> {
  return loadRelationsForItem(item, meta, prismaRelationAdapter(prisma), includeOptions);
}

/**
 * Batch loads relations for multiple items to avoid N+1 queries.
 * Instead of N queries per relation, this uses 1 query per relation using `in` operator.
 */
export async function batchLoadPrismaRelations<
  T extends Record<string, unknown>,
  M extends MetaInput,
>(prisma: PrismaClient, items: T[], meta: M, includeOptions?: IncludeOptions): Promise<T[]> {
  return batchLoadRelations(items, meta, prismaRelationAdapter(prisma), includeOptions);
}

/**
 * Options for executing a Prisma list query.
 */
export interface PrismaQueryOptions<Row = Record<string, unknown>> {
  /** The Prisma model operations */
  model: PrismaModelOperations<Row>;
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
  /**
   * Keyset (cursor) pagination field. When set, a request carrying
   * `cursor`/`limit` options runs Prisma's native cursor window
   * (`cursor: { [field]: decoded }` + `skip: 1` + `take: n+1`) instead of
   * offset pagination. Only the List endpoint passes this.
   */
  cursorField?: string;
}

/**
 * Result of a Prisma list query.
 */
export interface PrismaQueryResult<Row = Record<string, unknown>> {
  /** The fetched records (in cursor mode: up to `limit + 1` rows) */
  records: Row[];
  /** The WHERE clause used */
  where: Record<string, unknown>;
  /** Total count of matching records (never includes the cursor window) */
  totalCount: number;
  /** Current page number */
  page: number;
  /** Items per page */
  perPage: number;
  /** Total number of pages */
  totalPages: number;
  /**
   * Present when the native cursor window ran instead of offset pagination.
   * The offset fields above are then not meaningful — build the envelope
   * with core's `buildCursorPage`.
   */
  cursor?: { limit: number; applied: boolean };
}

/**
 * Executes a common Prisma list query with filtering, sorting, and pagination.
 * This helper reduces code duplication across the List and Export endpoints
 * (Search assembles its own search-specific WHERE and stays separate).
 *
 * Cursor mode (when `cursorField` is set and the request carries
 * `cursor`/`limit` options) uses Prisma's NATIVE cursor: `cursor: { [field]:
 * decoded }` + `skip: 1` + `take: limit + 1` (the surplus row is the
 * has-more sentinel). The ordering is already forced to the cursor field
 * ascending by core's `parseListFilters`. An invalid cursor starts from the
 * beginning.
 *
 * Native-cursor divergence from the drizzle/memory keyset predicates
 * (`WHERE cursorField > decoded`): Prisma requires the boundary row to still
 * EXIST — a cursor pointing at a since-deleted row yields an empty page
 * (documented Prisma behavior). This is a native-API limitation, documented
 * rather than papered over.
 *
 * @param options - Query configuration options
 * @returns Query result with records and pagination info
 */
export async function executePrismaQuery<Row = Record<string, unknown>>(
  options: PrismaQueryOptions<Row>,
): Promise<PrismaQueryResult<Row>> {
  const {
    model,
    filters,
    searchFields = [],
    softDeleteConfig,
    defaultPerPage = 20,
    additionalWhere = {},
    cursorField,
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

  // Build orderBy (cursor mode arrives here already forced to cursorField asc)
  let orderBy: Record<string, string> | undefined;
  if (filters.options.order_by) {
    orderBy = {
      [filters.options.order_by]: filters.options.order_by_direction || 'asc',
    };
  }

  // Native cursor (keyset) window
  const cursorMode =
    cursorField !== undefined &&
    (filters.options.cursor !== undefined || filters.options.limit !== undefined);

  if (cursorMode) {
    const limit = filters.options.limit || filters.options.per_page || defaultPerPage;
    const decoded = filters.options.cursor ? decodeCursor(filters.options.cursor) : null;

    const records = await model.findMany({
      where,
      orderBy,
      take: limit + 1,
      // `skip: 1` skips the boundary row itself; `coerceValue` restores the
      // field's native type (cursors round-trip through strings).
      ...(decoded !== null ? { cursor: { [cursorField]: coerceValue(decoded) }, skip: 1 } : {}),
    });

    return {
      records,
      where,
      totalCount,
      page: 0,
      perPage: limit,
      totalPages: 0,
      cursor: { limit, applied: decoded !== null },
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
 * Builds a PaginatedResult from offset-mode query results. Cursor-mode
 * results go through core's `buildCursorPage` instead.
 */
export function buildPaginatedResult<T>(
  items: T[],
  queryResult: PrismaQueryResult<unknown>,
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
 */
export async function findByUpsertKeys<Row>(
  model: PrismaModelOperations<Row>,
  data: Record<string, unknown>,
  upsertKeys: string[],
): Promise<Row | null> {
  const where: Record<string, unknown> = {};
  for (const key of upsertKeys) {
    const value = data[key];
    if (value !== undefined) {
      where[key] = value;
    }
  }

  if (Object.keys(where).length === 0) {
    return null;
  }

  const result = await model.findFirst({ where });
  return result ?? null;
}

/**
 * Escape LIKE wildcard characters so a user-supplied needle reaches
 * Prisma's `contains` as literal text.
 *
 * Despite docs suggesting `contains` is a literal substring match, it
 * compiles to SQL LIKE without escaping user input — `_` (and `%`) act as
 * live single/multi-char wildcards (verified against Postgres 16 via
 * @prisma/adapter-pg). Backslash is escaped first so pre-existing
 * backslashes can't un-escape the wildcard escapes.
 */
export function escapeLikeWildcards(needle: string): string {
  return needle.replace(/\\/g, '\\\\').replace(/[%_]/g, (match) => `\\${match}`);
}
