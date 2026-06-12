/**
 * Cell 11 — Keyset cursor pagination: next_cursor-only walk + exact
 * cursor-mode result_info shape + forced cursor-field ordering.
 *
 * Cursor pagination used to be implemented only by the memory adapter while
 * core advertised it for every adapter (audit findings 45/75) — Drizzle and
 * Prisma silently fell back to offset pagination. This cell pins the real
 * keyset behavior on all three adapters:
 *
 * - the walk visits every record exactly once, ordered by the cursor field
 *   (`id`) ascending;
 * - the cursor-mode envelope is exactly `{ page: 0, per_page, total_count,
 *   has_next_page, has_prev_page, next_cursor? }` — no `total_pages`, and no
 *   `prev_cursor` anywhere (walks are next-only, Stripe-style);
 * - the last page carries no `next_cursor`;
 * - user `sort`/`order` are IGNORED during a cursor walk (ORDER BY is forced
 *   to the cursor field — keyset pagination is only correct on that order);
 * - plain page/per_page requests on a cursor-enabled endpoint still use
 *   offset pagination with the canonical 6-field result_info.
 *
 * The companion loud-failure contract (ConfigurationException when
 * `cursorPaginationEnabled` is set on an adapter without support) is pinned
 * as a unit test in tests/new-features.test.ts, where an endpoint subclass
 * can override `supportsCursorPagination = false`.
 */
import { expect, test } from 'vitest';
import type {
  AdapterDescriptor,
  ConformanceApp,
  ConformanceRecord,
  CtxGetter,
  CursorListEnvelope,
  CursorResultInfo,
} from '../contract';
import { createRecord, expectList, readJson } from '../contract';

const BASE = '/cursor-items';

/** Seeds 7 rows and returns their ids in ascending (cursor-field) order. */
async function seedCursorRows(app: ConformanceApp): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    const created = await createRecord(app, BASE, {
      name: `Cursor Row ${i}`,
      email: `cursor-${i}@conformance.test`,
      role: 'user',
      age: 20 + i,
    });
    ids.push(created.id);
  }
  return ids.sort();
}

async function fetchCursorPage(
  app: ConformanceApp,
  query: string,
): Promise<CursorListEnvelope<ConformanceRecord>> {
  const response = await app.request(`${BASE}?${query}`);
  expect(response.status).toBe(200);
  const body = await readJson<CursorListEnvelope<ConformanceRecord>>(response);
  expect(body.success).toBe(true);
  expect(Array.isArray(body.result)).toBe(true);
  return body;
}

/** Cursors are base64 and may contain `+`/`=` — always URL-encode them. */
function cursorQuery(info: CursorResultInfo, extra = ''): string {
  expect(info.next_cursor).toBeDefined();
  return `cursor=${encodeURIComponent(info.next_cursor as string)}&limit=3${extra}`;
}

export function registerCursorPaginationCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('cursor pagination: next-only walk visits every record in cursor-field order with exact result_info', async () => {
    const { app } = ctx();
    const idsSorted = await seedCursorRows(app);

    const infoFor = (hasNext: boolean, hasPrev: boolean) => ({
      page: 0,
      per_page: 3,
      total_count: 7,
      has_next_page: hasNext,
      has_prev_page: hasPrev,
    });

    const page1 = await fetchCursorPage(app, 'limit=3');
    expect(page1.result.map((record) => record.id)).toEqual(idsSorted.slice(0, 3));
    expect(page1.result_info).toEqual({ ...infoFor(true, false), next_cursor: expect.any(String) });
    expect('prev_cursor' in page1.result_info).toBe(false);
    expect('total_pages' in page1.result_info).toBe(false);

    const page2 = await fetchCursorPage(app, cursorQuery(page1.result_info));
    expect(page2.result.map((record) => record.id)).toEqual(idsSorted.slice(3, 6));
    expect(page2.result_info).toEqual({ ...infoFor(true, true), next_cursor: expect.any(String) });
    expect('prev_cursor' in page2.result_info).toBe(false);

    const page3 = await fetchCursorPage(app, cursorQuery(page2.result_info));
    expect(page3.result.map((record) => record.id)).toEqual(idsSorted.slice(6));
    expect(page3.result_info).toEqual(infoFor(false, true));
    expect('next_cursor' in page3.result_info).toBe(false);
    expect('prev_cursor' in page3.result_info).toBe(false);

    // The walk covers every record exactly once, in cursor-field order.
    const walked = [...page1.result, ...page2.result, ...page3.result].map(
      (record) => record.id,
    );
    expect(walked).toEqual(idsSorted);
  });

  test('cursor pagination: user sort/order are ignored during a cursor walk (ORDER BY forced to cursor field)', async () => {
    const { app } = ctx();
    const idsSorted = await seedCursorRows(app);

    // `sort=email&order=desc` would reverse the seed order; with a cursor
    // walk in play the results MUST come back ordered by the cursor field
    // (`id`) ascending — on the first page and on cursor-following pages.
    const page1 = await fetchCursorPage(app, 'limit=3&sort=email&order=desc');
    expect(page1.result.map((record) => record.id)).toEqual(idsSorted.slice(0, 3));

    const page2 = await fetchCursorPage(app, cursorQuery(page1.result_info, '&sort=email&order=desc'));
    expect(page2.result.map((record) => record.id)).toEqual(idsSorted.slice(3, 6));
  });

  test('cursor pagination: plain page/per_page requests on a cursor-enabled endpoint stay offset-paginated', async () => {
    const { app } = ctx();
    await seedCursorRows(app);

    const offset = await expectList(await app.request(`${BASE}?page=2&per_page=3`));
    expect(offset.result).toHaveLength(3);
    expect(offset.result_info).toEqual({
      page: 2,
      per_page: 3,
      total_count: 7,
      total_pages: 3,
      has_next_page: true,
      has_prev_page: true,
    });
    expect('next_cursor' in offset.result_info).toBe(false);
    expect('prev_cursor' in offset.result_info).toBe(false);
  });
}
