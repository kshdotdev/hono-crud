import {
  assertNever,
  FILTER_OPERATORS,
  isFilterOperator,
  parseFilterValue,
} from 'hono-crud';
import { describe, expect, it } from 'vitest';

describe('FilterOperator single source of truth', () => {
  it('FILTER_OPERATORS lists every supported operator', () => {
    expect([...FILTER_OPERATORS]).toEqual([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'nin',
      'like',
      'ilike',
      'null',
      'between',
    ]);
  });

  it('isFilterOperator accepts known operators and rejects unknown tokens', () => {
    for (const op of FILTER_OPERATORS) {
      expect(isFilterOperator(op)).toBe(true);
    }
    expect(isFilterOperator('foo')).toBe(false);
    expect(isFilterOperator('')).toBe(false);
    expect(isFilterOperator('EQ')).toBe(false);
  });
});

describe('parseFilterValue', () => {
  it('parses a recognized operator from the bracket syntax', () => {
    expect(parseFilterValue('[gte]30')).toEqual({ operator: 'gte', value: '30' });
  });

  it('splits array operators into trimmed parts', () => {
    expect(parseFilterValue('[in]1, 2 ,3')).toEqual({ operator: 'in', value: ['1', '2', '3'] });
  });

  it('coerces the null operator to a boolean', () => {
    expect(parseFilterValue('[null]true')).toEqual({ operator: 'null', value: true });
  });

  it('neutralizes an unknown operator instead of forging an invalid one', () => {
    // Regression: `[foo]30` was previously cast to `{ operator: 'foo' }`, an
    // invalid operator that downstream adapters silently ignored — disabling
    // the filter and returning every row. It must now fall back to literal
    // equality on the raw value so it cannot act as an operator.
    expect(parseFilterValue('[foo]30')).toEqual({ operator: 'eq', value: '[foo]30' });
  });

  it('treats a plain value as equality', () => {
    expect(parseFilterValue('hello')).toEqual({ operator: 'eq', value: 'hello' });
  });
});

describe('assertNever', () => {
  it('throws when reached at runtime (invariant violation)', () => {
    // `assertNever` is a compile-time exhaustiveness guard; if a closed union
    // ever reaches it at runtime, it fails loud rather than continuing.
    expect(() => assertNever('unexpected' as never)).toThrow(/Unhandled discriminated union member/);
  });
});
