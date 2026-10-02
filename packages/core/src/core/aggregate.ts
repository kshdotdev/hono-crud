/**
 * Parse aggregation query parameters into structured `AggregateOptions`.
 */

import { InputValidationException } from './exceptions';
import {
  AGGREGATE_OPERATIONS,
  type AggregateField,
  type AggregateOperation,
  type AggregateOptions,
} from './types';

/**
 * Parse aggregation field from query string.
 * Supports formats like: "count:*", "sum:amount", "avg:price:averagePrice"
 */
export function parseAggregateField(value: string): AggregateField | null {
  const parts = value.split(':');
  if (parts.length < 2) return null;

  const rawOp = parts[0].toLowerCase();
  // Case-insensitive match against the canonical operations (derived, so a new
  // operation added to AGGREGATE_OPERATIONS is recognized here automatically).
  const validOps: readonly string[] = AGGREGATE_OPERATIONS.map((op) => op.toLowerCase());

  if (!validOps.includes(rawOp)) {
    return null;
  }

  // Normalize countdistinct to countDistinct
  const operation: AggregateOperation =
    rawOp === 'countdistinct' ? 'countDistinct' : (rawOp as AggregateOperation);

  return {
    operation,
    field: parts[1],
    alias: parts[2],
  };
}

/** Soft-delete settings `parseAggregateQuery` needs from the endpoint's model. */
export interface AggregateQueryParseOptions {
  /** Query param that asks for soft-deleted rows. @default 'withDeleted' */
  softDeleteQueryParam?: string;
  /** Whether clients may ask for soft-deleted rows (`softDelete.allowQueryDeleted`). @default true */
  allowQueryDeleted?: boolean;
}

/**
 * Parse a `limit` / `offset` query value as an integer >= `min`, or throw a
 * 400. The query schema keeps both as strings so this is their only
 * validation (a coercing schema would hand this parser numbers it skips).
 * `limit` starts at 1: paging reads a 0 limit as "no limit", so `?limit=0`
 * would skip both `defaultLimit` and `maxLimit`.
 */
function parseIntegerParam(name: string, value: unknown, min: number): number | undefined {
  if (value === undefined) return undefined;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new InputValidationException(`'${name}' expects an integer >= ${min}, got '${raw}'`);
  }
  return Number(raw);
}

/**
 * Parse aggregations from query parameters.
 */
export function parseAggregateQuery(
  query: Record<string, unknown>,
  options: AggregateQueryParseOptions = {},
): AggregateOptions {
  const { softDeleteQueryParam = 'withDeleted', allowQueryDeleted = true } = options;
  const aggregations: AggregateField[] = [];
  const filters: Record<string, unknown> = {};

  // Parse individual aggregation params
  for (const op of AGGREGATE_OPERATIONS) {
    const value = query[op];
    if (value) {
      const fields = Array.isArray(value) ? value : [value];
      for (const field of fields) {
        if (typeof field === 'string') {
          aggregations.push({
            operation: op,
            field: field === 'true' || field === '' ? '*' : field,
          });
        }
      }
    }
  }

  // Parse groupBy
  let groupBy: string[] | undefined;
  if (query.groupBy) {
    const groupByValue = query.groupBy;
    if (typeof groupByValue === 'string') {
      groupBy = groupByValue.split(',').map((s) => s.trim());
    } else if (Array.isArray(groupByValue)) {
      groupBy = groupByValue.filter((s) => typeof s === 'string') as string[];
    }
  }

  // Parse having (format: having[alias][op]=value)
  let having: Record<string, Record<string, unknown>> | undefined;
  for (const [key, value] of Object.entries(query)) {
    const havingMatch = key.match(/^having\[(\w+)\]\[(\w+)\]$/);
    if (havingMatch) {
      const [, alias, op] = havingMatch;
      if (!having) having = {};
      if (!having[alias]) having[alias] = {};
      having[alias][op] = value;
    }
  }

  // Parse orderBy
  const orderBy = typeof query.orderBy === 'string' ? query.orderBy : undefined;
  const orderDirection = query.orderDirection === 'desc' ? 'desc' : 'asc';

  // Parse pagination
  const limit = parseIntegerParam('limit', query.limit, 1);
  const offset = parseIntegerParam('offset', query.offset, 0);

  // The soft-delete param is always reserved (never a filter); it only takes
  // effect when the model lets clients ask for deleted rows.
  const withDeleted =
    allowQueryDeleted && String(query[softDeleteQueryParam]).toLowerCase() === 'true';

  // Collect remaining params as filters
  const reservedParams = [
    ...AGGREGATE_OPERATIONS,
    'groupBy',
    'orderBy',
    'orderDirection',
    'limit',
    'offset',
    softDeleteQueryParam,
  ];
  for (const [key, value] of Object.entries(query)) {
    if (!reservedParams.includes(key) && !key.startsWith('having[')) {
      filters[key] = value;
    }
  }

  return {
    aggregations,
    groupBy,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    having,
    orderBy,
    orderDirection,
    limit,
    offset,
    ...(withDeleted ? { withDeleted } : {}),
  };
}
