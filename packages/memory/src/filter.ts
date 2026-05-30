import type { FilterCondition } from 'hono-crud/internal';

/**
 * Compile-time exhaustiveness guard for `FilterOperator`.
 *
 * The parameter is typed `never`, so if a new member is ever added to
 * `FilterOperator` in core, every `default` branch that calls this stops
 * type-checking until the new operator is handled — turning what used to be a
 * silent runtime gap into a build error.
 *
 * At runtime the only way an unrecognized operator reaches here is from
 * untrusted query input: `parseFilterValue` matches `field[op]=value` with a
 * permissive regex and casts the captured `op` to `FilterOperator` without
 * validating it. We therefore fail **closed** (match nothing) instead of the
 * previous `default: return true`, which silently disabled the filter and
 * returned every record — a filter-bypass / data-exposure footgun.
 */
function unknownOperator(_operator: never): false {
  return false;
}

/**
 * Evaluate a single {@link FilterCondition} against an already-extracted field
 * value, using the in-memory adapter's filter semantics.
 *
 * This is the single source of truth for operator handling across the in-memory
 * adapter (list / search / export / bulk-patch). Previously the same 12-case
 * switch was copy-pasted at four call sites, and they had already drifted — one
 * copy was missing the `between` case, so `between` filters there silently
 * matched every record.
 */
export function matchesFilter(value: unknown, filter: FilterCondition): boolean {
  switch (filter.operator) {
    case 'eq':
      return String(value) === String(filter.value);
    case 'ne':
      return String(value) !== String(filter.value);
    case 'gt':
      return Number(value) > Number(filter.value);
    case 'gte':
      return Number(value) >= Number(filter.value);
    case 'lt':
      return Number(value) < Number(filter.value);
    case 'lte':
      return Number(value) <= Number(filter.value);
    case 'in':
      return (filter.value as unknown[]).map(String).includes(String(value));
    case 'nin':
      return !(filter.value as unknown[]).map(String).includes(String(value));
    case 'like':
      return String(value).includes(String(filter.value).replace(/%/g, ''));
    case 'ilike':
      return String(value)
        .toLowerCase()
        .includes(String(filter.value).replace(/%/g, '').toLowerCase());
    case 'null':
      return filter.value ? value === null : value !== null;
    case 'between': {
      const [min, max] = filter.value as [unknown, unknown];
      return Number(value) >= Number(min) && Number(value) <= Number(max);
    }
    default:
      return unknownOperator(filter.operator);
  }
}
