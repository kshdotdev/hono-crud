import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { parseAggregateQuery } from '../core/aggregate';
import { AggregationException } from '../core/exceptions';
import type {
  AggregateConfig,
  AggregateField,
  AggregateOperation,
  AggregateOptions,
  AggregateResult,
  MetaInput,
  OpenAPIRouteSchema,
} from '../core/types';
import { SORT_DIRECTIONS } from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema, mergeRouteSchema } from './responses';
import { coerceFilterValue } from './types';

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
 * Per-operation field-restriction rules, exhaustive over `AggregateOperation`:
 * a newly-added operation cannot silently skip field-restriction validation
 * (a security gap) — it fails to compile here until given a rule. `null`
 * means the operation has no per-field allow-list (COUNT).
 */
const AGG_FIELD_RULES = {
  count: null,
  sum: { field: 'sumFields', label: 'SUM' },
  avg: { field: 'avgFields', label: 'AVG' },
  min: { field: 'minMaxFields', label: 'MIN/MAX' },
  max: { field: 'minMaxFields', label: 'MIN/MAX' },
  countDistinct: { field: 'countDistinctFields', label: 'COUNT DISTINCT' },
} satisfies Record<
  AggregateOperation,
  {
    field: 'sumFields' | 'avgFields' | 'minMaxFields' | 'countDistinctFields';
    label: string;
  } | null
>;

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
> extends CrudEndpoint<E, M> {
  /**
   * Configuration for allowed aggregations.
   * Override to restrict which fields can be aggregated.
   */
  // Deliberately WIDE (not AggregateConfig<FieldsOf<M>>): class property
  // overrides get no contextual typing from the base, so a subclass's
  // `aggregateConfig = { sumFields: ['price'] }` would widen to string[] and
  // fail against a narrowed field union — rejecting the documented authoring
  // pattern. Schema-checked aggregate fields live on the config-API surface
  // (AggregateEndpointConfig.fields) and on explicit annotations via
  // AggregateConfig<FieldsOf<M>>.
  protected aggregateConfig: AggregateConfig = {};

  /**
   * Maximum number of GROUP BY fields allowed per query.
   * Prevents cardinality explosion from too many grouping dimensions.
   */
  protected maxGroupByFields = 5;

  /**
   * Fields clients may filter by (`?field=value`, equality only). Empty means
   * every model field. Other query keys are ignored, and values are converted
   * and checked against the field type exactly like list filters (a value
   * outside an enum is 400).
   */
  protected filterFields: string[] = [];

  /** `filterFields`, or every model field when it is empty. */
  protected getFilterableFields(): string[] {
    return this.filterFields.length > 0
      ? this.filterFields
      : Object.keys(this.getModelSchema().shape);
  }

  /**
   * Get the soft delete configuration for this model.
   */

  /**
   * Check if soft delete is enabled for this model.
   */

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
    const shape: Record<string, z.ZodTypeAny> = {
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
      orderDirection: z.enum(SORT_DIRECTIONS).optional(),
      // Pagination. Strings, like list's page/per_page: `parseAggregateQuery`
      // parses them (a coercing schema here hid them from the parser).
      limit: z.string().optional(),
      offset: z.string().optional(),
    };

    // Same gate as list: only advertised when clients may ask for deleted rows.
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled && softDeleteConfig.allowQueryDeleted) {
      shape[softDeleteConfig.queryParam] = z.enum(['true', 'false']).optional();
    }

    // Reserved params win over a model field of the same name (the parser
    // consumes them before filters are collected).
    const filterFields = this.getFilterableFields().filter((field) => !(field in shape));
    this.addFilterParams(shape, filterFields);

    return z.object(shape).passthrough() as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const groupResultSchema = z.object({
      key: z.record(z.string(), z.unknown()),
      values: z.record(z.string(), z.number().nullable()),
    });

    return mergeRouteSchema(
      {
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
          400: errorResponseSchema('Invalid aggregation request'),
        },
      },
      this.schema,
    );
  }

  /**
   * Gets the aggregation options from query parameters.
   */
  protected async getAggregateOptions(): Promise<AggregateOptions> {
    const { query } = await this.getValidatedData();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const options = parseAggregateQuery(query || {}, {
      softDeleteQueryParam: softDeleteConfig.queryParam,
      allowQueryDeleted: softDeleteConfig.enabled && softDeleteConfig.allowQueryDeleted,
    });
    options.filters = this.toAllowedFilters(options.filters);
    return options;
  }

  /**
   * Keep only filterable fields and convert each value by the field's type.
   * The parser hands over every unreserved query key, and the adapter would
   * look any other key (`?page=1`, a typo) up as a column.
   */
  private toAllowedFilters(
    filters: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!filters) return undefined;
    const allowed = this.getFilterableFields();
    const modelShape: Record<string, unknown> = this.getModelSchema().shape;
    const kept: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(filters)) {
      if (!allowed.includes(field)) continue;
      const value = coerceFilterValue('eq', String(raw), field, modelShape[field]);
      // Adapters read an object filter value as `{ operator: value }`, so a
      // bare `Date` (a date field) would match every row; spell it as `eq`.
      kept[field] = typeof value === 'object' && value !== null ? { eq: value } : value;
    }
    return Object.keys(kept).length > 0 ? kept : undefined;
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

      // Check field restrictions based on operation. AGG_FIELD_RULES is
      // exhaustive over AggregateOperation, so a newly-added operation cannot
      // silently skip field-restriction validation (a security gap).
      // COUNT on a specific field is unrestricted (COUNT(*) handled above).
      const rule = AGG_FIELD_RULES[agg.operation];
      if (rule) {
        const allowed = config[rule.field];
        if (allowed.length > 0 && !allowed.includes(agg.field)) {
          throw new AggregationException(
            `Field '${agg.field}' is not allowed for ${rule.label} aggregation`,
          );
        }
      }
    }

    // Validate groupBy fields
    if (options.groupBy) {
      if (options.groupBy.length > this.maxGroupByFields) {
        throw new AggregationException(`Maximum ${this.maxGroupByFields} GROUP BY fields allowed`);
      }
      for (const field of options.groupBy) {
        if (config.groupByFields.length > 0 && !config.groupByFields.includes(field)) {
          throw new AggregationException(`Field '${field}' is not allowed for GROUP BY`);
        }
      }
    }

    // Apply limit constraints
    if (options.limit !== undefined) {
      if (options.limit > config.maxLimit) {
        throw new AggregationException(`Limit cannot exceed ${config.maxLimit}`);
      }
    }
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
   * Lifecycle hook: called after the aggregation is computed.
   * Override to post-process the result before the response is built.
   */
  async after(result: AggregateResult): Promise<AggregateResult> {
    return result;
  }

  /**
   * Main handler for the aggregate operation.
   */
  async handle(): Promise<Response> {
    const options = await this.getAggregateOptions();

    // Force the owner field to the caller's tenant so aggregations only ever
    // span the caller's own rows. The aggregate WHERE clause is a Record, so
    // this overwrites any client-supplied value for the owner field.
    options.filters = this.applyTenantScopeToAggregateFilters(options.filters);

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

    // Perform the aggregation, then the after hook.
    //
    // NOTE: no `decryptOnRead` here — aggregate deliberately does NOT decrypt.
    // Field encryption is non-deterministic (a fresh random IV per write), so a
    // configured field never yields equal ciphertext for equal plaintext:
    // GROUP BY on an encrypted field fragments into singletons, and MIN/MAX
    // return an arbitrary ciphertext, not a meaningful plaintext extremum.
    // Numeric aggregations (count/sum/avg) never expose the plaintext at all.
    // Aggregating over encrypted fields is therefore unsupported by design, and
    // leaving group keys as ciphertext is also the safer default (no plaintext
    // PII in an aggregate response). See docs/advanced-features.md.
    const result = await this.after(await this.aggregate(options));

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
  options: AggregateOptions,
): AggregateResult {
  const { aggregations, groupBy, having } = options;

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
    const keyParts = groupBy.map((field) => String(record[field] ?? 'null'));
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
    groupResults = groupResults.filter((group) => {
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

  return orderAndPageGroups(groupResults, options);
}

// ============================================================================
// Aggregation Operations
// ============================================================================

/**
 * Extract numeric values from records for a given field.
 */
function getNumericValues<T extends Record<string, unknown>>(
  records: T[],
  field: string,
): number[] {
  return records.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
}

/**
 * Type for aggregation function.
 */
type AggregationFn = <T extends Record<string, unknown>>(
  records: T[],
  field: string,
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
    return records.filter((r) => r[field] !== null && r[field] !== undefined).length;
  },

  countDistinct: (records, field) => {
    const uniqueValues = new Set(
      records
        .map((r) => r[field])
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v)),
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
  agg: AggregateField,
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

/** One grouped aggregation row: the GROUP BY key and its aggregated values. */
type AggregateGroup = NonNullable<AggregateResult['groups']>[number];

/**
 * Order and page grouped aggregation results (`orderBy` / `orderDirection` /
 * `limit` / `offset`), reporting `totalGroups` before paging. Shared by the
 * in-memory path and adapters that group natively (prisma `groupBy`), so
 * `?limit=` means the same thing on every adapter.
 */
export function orderAndPageGroups(
  groups: AggregateGroup[],
  options: Pick<AggregateOptions, 'orderBy' | 'orderDirection' | 'limit' | 'offset'>,
): { groups: AggregateGroup[]; totalGroups: number } {
  const { orderBy, orderDirection, limit, offset } = options;
  let groupResults = [...groups];

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
