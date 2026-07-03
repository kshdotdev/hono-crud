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

/** Input for {@link buildOffsetPageInfo}. */
export interface OffsetPageInfoInput {
  /** 1-based page number (`?page=`, falling back to 1). */
  page: number;
  /** Page size (`?per_page=`, falling back to the adapter default). */
  perPage: number;
  /** Total rows matching the filters (WITHOUT the pagination window). */
  totalCount: number;
}

/**
 * Builds the offset-mode `result_info` envelope shared by the three adapters
 * (memory/drizzle/prisma) so their offset pages return byte-identical shapes:
 * `{ page, per_page, total_count, total_pages, has_next_page, has_prev_page }`
 * — no `next_cursor` (that is cursor mode; see {@link buildCursorPage}).
 * `total_pages` is computed here as `ceil(totalCount / perPage)`, so callers
 * pass raw `page`/`perPage`/`totalCount` and never precompute it;
 * `has_next_page` is `page < total_pages` and `has_prev_page` is `page > 1`.
 */
export function buildOffsetPageInfo(
  input: OffsetPageInfoInput,
): PaginatedResult<unknown>['result_info'] {
  const { page, perPage, totalCount } = input;
  const totalPages = Math.ceil(totalCount / perPage);
  return {
    page,
    per_page: perPage,
    total_count: totalCount,
    total_pages: totalPages,
    has_next_page: page < totalPages,
    has_prev_page: page > 1,
  };
}
