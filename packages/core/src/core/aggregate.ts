/**
 * Parse aggregation query parameters into structured `AggregateOptions`.
 */

import type { AggregateField, AggregateOperation, AggregateOptions } from './types';

/**
 * Parse aggregation field from query string.
 * Supports formats like: "count:*", "sum:amount", "avg:price:averagePrice"
 */
export function parseAggregateField(value: string): AggregateField | null {
  const parts = value.split(':');
  if (parts.length < 2) return null;

  const rawOp = parts[0].toLowerCase();
  const validOps = ['count', 'sum', 'avg', 'min', 'max', 'countdistinct'];

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

/**
 * Parse aggregations from query parameters.
 */
export function parseAggregateQuery(query: Record<string, unknown>): AggregateOptions {
  const aggregations: AggregateField[] = [];
  const filters: Record<string, unknown> = {};

  // Parse individual aggregation params
  const aggParams = ['count', 'sum', 'avg', 'min', 'max', 'countDistinct'];

  for (const op of aggParams) {
    const value = query[op];
    if (value) {
      const fields = Array.isArray(value) ? value : [value];
      for (const field of fields) {
        if (typeof field === 'string') {
          aggregations.push({
            operation: op as AggregateOperation,
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
  const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;
  const offset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : undefined;

  // Collect remaining params as filters
  const reservedParams = [...aggParams, 'groupBy', 'orderBy', 'orderDirection', 'limit', 'offset'];
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
  };
}
