import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route.js';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  AggregateOperation,
  AggregateField,
  AggregateOptions,
  AggregateResult,
  AggregateConfig,
  NormalizedSoftDeleteConfig,
  FilterCondition,
} from '../core/types.js';
import { getSoftDeleteConfig, parseAggregateQuery } from '../core/types.js';

/**
 * Default aggregate configuration.
 */
const DEFAULT_AGGREGATE_CONFIG: Required<AggregateConfig> = {
  sumFields: [],
  avgFields: [],
  minMaxFields: [],
  countDistinctFields: [],
  groupByFields: [],
  defaultLimit: 100,
  maxLimit: 1000,
};

/**
 * Base endpoint for aggregate queries.
 * Extend this class and implement the `aggregate` method for your ORM.
 *
 * Supports: COUNT, SUM, AVG, MIN, MAX, COUNT_DISTINCT with GROUP BY.
 *
 * @example
 * ```
 * GET /users/aggregate?count=*
 * GET /users/aggregate?count=id&avg=age&groupBy=role
 * GET /products/aggregate?sum=price&min=price&max=price&groupBy=category
 * GET /orders/aggregate?sum=total&groupBy=status&having[sum][gte]=1000
 * ```
 */
export abstract class AggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /**
   * Configuration for allowed aggregations.
   * Override to restrict which fields can be aggregated.
   */
  protected aggregateConfig: AggregateConfig = {};

  /**
   * Fields that can be used for filtering.
   * Empty array means all fields are allowed.
   */
  protected filterFields: string[] = [];

  /**
   * Get the soft delete configuration for this model.
   */
  protected getSoftDeleteConfig(): NormalizedSoftDeleteConfig {
    return getSoftDeleteConfig(this._meta.model.softDelete);
  }

  /**
   * Check if soft delete is enabled for this model.
   */
  protected isSoftDeleteEnabled(): boolean {
    return this.getSoftDeleteConfig().enabled;
  }

  /**
   * Get normalized aggregate configuration with defaults.
   */
  protected getAggregateConfig(): Required<AggregateConfig> {
    return {
      ...DEFAULT_AGGREGATE_CONFIG,
      ...this.aggregateConfig,
    };
  }

  /**
   * Returns the query parameter schema for aggregations.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> {
    return z.object({
      // Aggregation operations
      count: z.union([z.string(), z.array(z.string())]).optional(),
      sum: z.union([z.string(), z.array(z.string())]).optional(),
      avg: z.union([z.string(), z.array(z.string())]).optional(),
      min: z.union([z.string(), z.array(z.string())]).optional(),
      max: z.union([z.string(), z.array(z.string())]).optional(),
      countDistinct: z.union([z.string(), z.array(z.string())]).optional(),
      // Grouping
      groupBy: z.string().optional(),
      // Ordering
      orderBy: z.string().optional(),
      orderDirection: z.enum(['asc', 'desc']).optional(),
      // Pagination
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
      // Include soft-deleted records
      withDeleted: z.coerce.boolean().optional(),
    }).passthrough() as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const groupResultSchema = z.object({
      key: z.record(z.string(), z.unknown()),
      values: z.record(z.string(), z.number().nullable()),
    });

    return {
      ...this.schema,
      request: {
        query: this.getQuerySchema(),
      },
      responses: {
        200: {
          description: 'Aggregation result',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  values: z.record(z.string(), z.number().nullable()).optional(),
                  groups: z.array(groupResultSchema).optional(),
                  totalGroups: z.number().optional(),
                }),
              }),
            },
          },
        },
        400: {
          description: 'Invalid aggregation request',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                  details: z.unknown().optional(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the aggregation options from query parameters.
   */
  protected async getAggregateOptions(): Promise<AggregateOptions> {
    const { query } = await this.getValidatedData();
    return parseAggregateQuery(query || {});
  }

  /**
   * Validates the aggregation request against the configuration.
   */
  protected validateAggregations(options: AggregateOptions): void {
    const config = this.getAggregateConfig();

    for (const agg of options.aggregations) {
      // COUNT(*) is always allowed
      if (agg.operation === 'count' && agg.field === '*') {
        continue;
      }

      // Check field restrictions based on operation
      switch (agg.operation) {
        case 'sum':
          if (config.sumFields.length > 0 && !config.sumFields.includes(agg.field)) {
            throw new Error(`Field '${agg.field}' is not allowed for SUM aggregation`);
          }
          break;
        case 'avg':
          if (config.avgFields.length > 0 && !config.avgFields.includes(agg.field)) {
            throw new Error(`Field '${agg.field}' is not allowed for AVG aggregation`);
          }
          break;
        case 'min':
        case 'max':
          if (config.minMaxFields.length > 0 && !config.minMaxFields.includes(agg.field)) {
            throw new Error(`Field '${agg.field}' is not allowed for MIN/MAX aggregation`);
          }
          break;
        case 'countDistinct':
          if (config.countDistinctFields.length > 0 && !config.countDistinctFields.includes(agg.field)) {
            throw new Error(`Field '${agg.field}' is not allowed for COUNT DISTINCT aggregation`);
          }
          break;
      }
    }

    // Validate groupBy fields
    if (options.groupBy) {
      for (const field of options.groupBy) {
        if (config.groupByFields.length > 0 && !config.groupByFields.includes(field)) {
          throw new Error(`Field '${field}' is not allowed for GROUP BY`);
        }
      }
    }

    // Apply limit constraints
    if (options.limit !== undefined) {
      if (options.limit > config.maxLimit) {
        throw new Error(`Limit cannot exceed ${config.maxLimit}`);
      }
    }
  }

  /**
   * Gets the alias for an aggregation result.
   */
  protected getAggregateAlias(agg: AggregateField): string {
    if (agg.alias) {
      return agg.alias;
    }
    if (agg.field === '*') {
      return agg.operation;
    }
    // camelCase: sumAmount, avgPrice, etc.
    return `${agg.operation}${agg.field.charAt(0).toUpperCase()}${agg.field.slice(1)}`;
  }

  /**
   * Performs the aggregation query.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param options - The aggregation options
   * @returns The aggregation result
   */
  abstract aggregate(options: AggregateOptions): Promise<AggregateResult>;

  /**
   * Main handler for the aggregate operation.
   */
  async handle(): Promise<Response> {

    const options = await this.getAggregateOptions();

    // Ensure at least one aggregation is requested
    if (options.aggregations.length === 0) {
      // Default to COUNT(*)
      options.aggregations.push({ operation: 'count', field: '*' });
    }

    // Validate the request
    this.validateAggregations(options);

    // Apply default limit for grouped queries
    const config = this.getAggregateConfig();
    if (options.groupBy && options.groupBy.length > 0 && options.limit === undefined) {
      options.limit = config.defaultLimit;
    }

    // Perform the aggregation
    const result = await this.aggregate(options);

    return this.success(result);
  }
}

// ============================================================================
// Comparison Operators
// ============================================================================

/**
 * Map of comparison operators for HAVING clause.
 * O(1) lookup instead of switch statement.
 */
const COMPARISON_OPERATORS: Record<string, (value: number, threshold: number) => boolean> = {
  eq: (v, t) => v === t,
  ne: (v, t) => v !== t,
  gt: (v, t) => v > t,
  gte: (v, t) => v >= t,
  lt: (v, t) => v < t,
  lte: (v, t) => v <= t,
};

/**
 * Get or create a group in a Map.
 * Type-safe helper to avoid non-null assertions.
 */
function getOrCreateGroup<K, V>(map: Map<K, V[]>, key: K): V[] {
  const existing = map.get(key);
  if (existing) return existing;
  const newGroup: V[] = [];
  map.set(key, newGroup);
  return newGroup;
}

/**
 * Helper to compute aggregations in memory.
 * Useful for memory adapter and testing.
 */
export function computeAggregations<T extends Record<string, unknown>>(
  records: T[],
  options: AggregateOptions
): AggregateResult {
  const { aggregations, groupBy, having, orderBy, orderDirection, limit, offset } = options;

  // If no groupBy, compute single set of aggregations
  if (!groupBy || groupBy.length === 0) {
    const values: Record<string, number | null> = {};

    for (const agg of aggregations) {
      const alias = getAggregateAlias(agg);
      values[alias] = computeSingleAggregation(records, agg);
    }

    return { values };
  }

  // Group records
  const groups = new Map<string, T[]>();

  for (const record of records) {
    const keyParts = groupBy.map(field => String(record[field] ?? 'null'));
    const key = keyParts.join('|');
    getOrCreateGroup(groups, key).push(record);
  }

  // Compute aggregations for each group
  let groupResults: Array<{
    key: Record<string, unknown>;
    values: Record<string, number | null>;
  }> = [];

  for (const [keyStr, groupRecords] of groups) {
    const keyValues = keyStr.split('|');
    const key: Record<string, unknown> = {};
    groupBy.forEach((field, i) => {
      key[field] = keyValues[i] === 'null' ? null : keyValues[i];
    });

    const values: Record<string, number | null> = {};
    for (const agg of aggregations) {
      const alias = getAggregateAlias(agg);
      values[alias] = computeSingleAggregation(groupRecords, agg);
    }

    groupResults.push({ key, values });
  }

  // Apply HAVING filter using comparison operators map
  if (having) {
    groupResults = groupResults.filter(group => {
      for (const [alias, conditions] of Object.entries(having)) {
        const value = group.values[alias];
        if (value === null) continue;

        for (const [op, threshold] of Object.entries(conditions)) {
          const compareFn = COMPARISON_OPERATORS[op];
          if (compareFn && !compareFn(value, Number(threshold))) {
            return false;
          }
        }
      }
      return true;
    });
  }

  const totalGroups = groupResults.length;

  // Apply ordering
  if (orderBy) {
    const direction = orderDirection === 'desc' ? -1 : 1;
    groupResults.sort((a, b) => {
      // Check if ordering by an aggregated value
      if (orderBy in a.values) {
        const aVal = a.values[orderBy] ?? 0;
        const bVal = b.values[orderBy] ?? 0;
        return (aVal - bVal) * direction;
      }
      // Otherwise order by group key
      if (orderBy in a.key) {
        const aVal = String(a.key[orderBy] ?? '');
        const bVal = String(b.key[orderBy] ?? '');
        return aVal.localeCompare(bVal) * direction;
      }
      return 0;
    });
  }

  // Apply pagination
  if (offset !== undefined || limit !== undefined) {
    const start = offset || 0;
    const end = limit ? start + limit : undefined;
    groupResults = groupResults.slice(start, end);
  }

  return {
    groups: groupResults,
    totalGroups,
  };
}

// ============================================================================
// Aggregation Operations
// ============================================================================

/**
 * Extract numeric values from records for a given field.
 */
function getNumericValues<T extends Record<string, unknown>>(
  records: T[],
  field: string
): number[] {
  return records
    .map(r => r[field])
    .filter((v): v is number => typeof v === 'number');
}

/**
 * Type for aggregation function.
 */
type AggregationFn = <T extends Record<string, unknown>>(
  records: T[],
  field: string
) => number | null;

/**
 * Map of aggregation operations.
 * O(1) lookup instead of switch statement.
 */
const AGGREGATION_OPERATIONS: Record<AggregateOperation, AggregationFn> = {
  count: (records, field) => {
    if (field === '*') {
      return records.length;
    }
    return records.filter(r => r[field] !== null && r[field] !== undefined).length;
  },

  countDistinct: (records, field) => {
    const uniqueValues = new Set(
      records
        .map(r => r[field])
        .filter(v => v !== null && v !== undefined)
        .map(v => String(v))
    );
    return uniqueValues.size;
  },

  sum: (records, field) => {
    let sum = 0;
    for (const record of records) {
      const value = record[field];
      if (typeof value === 'number') {
        sum += value;
      }
    }
    return sum;
  },

  avg: (records, field) => {
    const numericValues = getNumericValues(records, field);
    if (numericValues.length === 0) return null;
    const sum = numericValues.reduce((a, b) => a + b, 0);
    return sum / numericValues.length;
  },

  min: (records, field) => {
    const numericValues = getNumericValues(records, field);
    if (numericValues.length === 0) return null;
    return Math.min(...numericValues);
  },

  max: (records, field) => {
    const numericValues = getNumericValues(records, field);
    if (numericValues.length === 0) return null;
    return Math.max(...numericValues);
  },
};

/**
 * Compute a single aggregation on a set of records.
 */
function computeSingleAggregation<T extends Record<string, unknown>>(
  records: T[],
  agg: AggregateField
): number | null {
  if (records.length === 0) {
    return agg.operation === 'count' ? 0 : null;
  }

  const aggregateFn = AGGREGATION_OPERATIONS[agg.operation];
  if (!aggregateFn) {
    return null;
  }

  return aggregateFn(records, agg.field);
}

/**
 * Get the alias for an aggregation.
 */
function getAggregateAlias(agg: AggregateField): string {
  if (agg.alias) {
    return agg.alias;
  }
  if (agg.field === '*') {
    return agg.operation;
  }
  return `${agg.operation}${agg.field.charAt(0).toUpperCase()}${agg.field.slice(1)}`;
}
