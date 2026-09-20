/**
 * Column-aware timestamp values for engine-managed writes.
 *
 * Core stamps `createdAt` / `updatedAt` / the soft-delete marker at the
 * write site, but the value a SQL driver can bind depends on how the column
 * was declared: a Drizzle `integer({ mode: 'timestamp' | 'timestamp_ms' })` or
 * `timestamp()` column expects a `Date` (Drizzle converts it), a plain
 * `integer()` expects epoch milliseconds, and a `text()` column expects a
 * string. Cloudflare D1 makes the distinction matter: its `bind()` rejects
 * objects outright, so a `Date` against a plain integer column fails with
 * `D1_TYPE_ERROR`, while libsql silently accepts it.
 *
 * The representation is read structurally from the column's `dataType`
 * (`'date' | 'number' | 'string' | …`), which every Drizzle column exposes
 * regardless of dialect, so this module needs no drizzle-orm import.
 */

/** How a column stores a point in time. */
export type TimestampRepresentation = 'date' | 'number' | 'string';

/**
 * The representation a Drizzle column expects for a timestamp write.
 * Unknown or non-column values fall back to `'date'` (Drizzle's own
 * timestamp column shape).
 */
export function resolveTimestampRepresentation(column: unknown): TimestampRepresentation {
  if (!column || typeof column !== 'object') return 'date';
  const dataType = String((column as { dataType?: unknown }).dataType ?? '').toLowerCase();
  if (dataType === 'number') return 'number';
  if (dataType === 'string') return 'string';
  return 'date';
}

/**
 * `now` in the representation the column can bind: a `Date`, epoch
 * milliseconds, or an ISO-8601 string.
 */
export function resolveTimestampValue(
  column: unknown,
  now: Date = new Date(),
): Date | number | string {
  switch (resolveTimestampRepresentation(column)) {
    case 'number':
      return now.getTime();
    case 'string':
      return now.toISOString();
    default:
      return now;
  }
}
