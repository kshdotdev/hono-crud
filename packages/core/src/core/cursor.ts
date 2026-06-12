/**
 * Cursor-pagination codec. Opaque base64 wrapper around a cursor value.
 */

import type { PaginatedResult } from './types';

/** Encodes a cursor value to an opaque base64 string. */
export function encodeCursor(value: string | number): string {
  return btoa(String(value));
}

/**
 * Decodes an opaque cursor string back to the original value.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): string | null {
  try {
    return atob(cursor);
  } catch {
    return null;
  }
}

/** Input for {@link buildCursorPage}. */
export interface CursorPageInput<T> {
  /**
   * The overfetched window: up to `limit + 1` rows ordered ascending by the
   * cursor field. The extra row is the has-more sentinel; the helper trims it.
   */
  rows: T[];
  /** Page size of the cursor walk (`?limit=`, falling back to per_page). */
  limit: number;
  /** Total rows matching the filters (WITHOUT the cursor window condition). */
  totalCount: number;
  /** Field the cursor encodes — `next_cursor` derives from the boundary row. */
  cursorField: string;
  /** Whether a valid decoded cursor was applied to this query (not page one). */
  cursorApplied: boolean;
}

/** Output of {@link buildCursorPage}: trimmed page + cursor-mode result_info. */
export interface CursorPage<T> {
  items: T[];
  result_info: PaginatedResult<T>['result_info'];
}

/**
 * Builds the cursor-mode page from an overfetched keyset window.
 *
 * The single source of the cursor-mode `result_info` envelope so the three
 * adapters (memory/drizzle/prisma) return byte-identical shapes:
 * `{ page: 0, per_page: limit, total_count, has_next_page, has_prev_page,
 * next_cursor? }` — no `total_pages`, no `prev_cursor` (cursor walks are
 * next-only, Stripe-style). Adapters fetch `limit + 1` rows ordered by the
 * cursor field; the surplus row proves there is a next page and is trimmed
 * here, and `next_cursor` encodes the boundary (last returned) row's cursor
 * field.
 */
export function buildCursorPage<T>(input: CursorPageInput<T>): CursorPage<T> {
  const { rows, limit, totalCount, cursorField, cursorApplied } = input;

  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  const boundary = items[items.length - 1] as unknown as Record<string, unknown> | undefined;

  return {
    items,
    result_info: {
      page: 0,
      per_page: limit,
      total_count: totalCount,
      has_next_page: hasNextPage,
      has_prev_page: cursorApplied,
      next_cursor:
        hasNextPage && boundary !== undefined
          ? encodeCursor(boundary[cursorField] as string | number)
          : undefined,
    },
  };
}
