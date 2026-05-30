import { DRIZZLE_DIALECTS } from '@hono-crud/drizzle';
import {
  AGGREGATE_OPERATIONS,
  CRUD_EVENT_TYPES,
  encryptedValueSchema,
  isEncryptedValue,
  JWT_ALGORITHMS,
  SEARCH_MODES,
  SORT_DIRECTIONS,
} from 'hono-crud';
import { describe, expect, it } from 'vitest';

// These lock the `as const` single-source arrays from which the corresponding
// TS unions and Zod/runtime validators are derived. If a value is added or
// reordered, update the source array — the union, the schemas and these
// expectations all move together, which is the whole point of single-sourcing.
describe('single-source enum arrays', () => {
  it('SORT_DIRECTIONS', () => {
    expect([...SORT_DIRECTIONS]).toEqual(['asc', 'desc']);
  });

  it('SEARCH_MODES', () => {
    expect([...SEARCH_MODES]).toEqual(['any', 'all', 'phrase']);
  });

  it('AGGREGATE_OPERATIONS', () => {
    expect([...AGGREGATE_OPERATIONS]).toEqual([
      'count',
      'sum',
      'avg',
      'min',
      'max',
      'countDistinct',
    ]);
  });

  it('JWT_ALGORITHMS', () => {
    expect([...JWT_ALGORITHMS]).toEqual([
      'HS256',
      'HS384',
      'HS512',
      'RS256',
      'RS384',
      'RS512',
      'ES256',
      'ES384',
      'ES512',
    ]);
  });

  it('CRUD_EVENT_TYPES', () => {
    expect([...CRUD_EVENT_TYPES]).toEqual(['created', 'updated', 'deleted', 'restored']);
  });

  it('DRIZZLE_DIALECTS', () => {
    expect([...DRIZZLE_DIALECTS]).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

describe('encryptedValueSchema drives isEncryptedValue', () => {
  it('accepts a well-formed encrypted value', () => {
    const value = { ct: 'abc', iv: 'def', v: 1 as const };
    expect(encryptedValueSchema.safeParse(value).success).toBe(true);
    expect(isEncryptedValue(value)).toBe(true);
  });

  it('rejects wrong version, missing fields, and non-objects', () => {
    expect(isEncryptedValue({ ct: 'a', iv: 'b', v: 2 })).toBe(false);
    expect(isEncryptedValue({ ct: 'a' })).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
    expect(isEncryptedValue('nope')).toBe(false);
  });
});
