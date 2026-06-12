/**
 * Cell 3 — Offset pagination: page/per_page walk + exact result_info shape.
 *
 * `result_info` is built independently inside each adapter
 * (memory crud.ts, drizzle crud.ts, prisma helpers.buildPaginatedResult);
 * this cell pins the canonical 6-field shape from core
 * (PaginatedResult.result_info) so the three implementations cannot drift.
 */
import { expect, test } from 'vitest';
import type { AdapterDescriptor, CtxGetter, ResultInfo } from '../contract';
import { expectList } from '../contract';
import { SEED_EMAILS_SORTED, seedFilterRows } from '../model';

export function registerPaginationCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('offset pagination: page walk returns every record exactly once with exact result_info', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    const infoFor = (page: number, hasNext: boolean, hasPrev: boolean): ResultInfo => ({
      page,
      per_page: 2,
      total_count: 5,
      total_pages: 3,
      has_next_page: hasNext,
      has_prev_page: hasPrev,
    });

    const pageRequest = (page: number) =>
      app.request(`/items?page=${page}&per_page=2&sort=email&order=asc`);

    const page1 = await expectList(await pageRequest(1));
    expect(page1.result.map((record) => record.email)).toEqual(SEED_EMAILS_SORTED.slice(0, 2));
    expect(page1.result_info).toEqual(infoFor(1, true, false));

    const page2 = await expectList(await pageRequest(2));
    expect(page2.result.map((record) => record.email)).toEqual(SEED_EMAILS_SORTED.slice(2, 4));
    expect(page2.result_info).toEqual(infoFor(2, true, true));

    const page3 = await expectList(await pageRequest(3));
    expect(page3.result.map((record) => record.email)).toEqual(SEED_EMAILS_SORTED.slice(4));
    expect(page3.result_info).toEqual(infoFor(3, false, true));

    // The walk covers every record exactly once.
    const walked = [...page1.result, ...page2.result, ...page3.result].map(
      (record) => record.email,
    );
    expect(walked).toEqual([...SEED_EMAILS_SORTED]);
  });

  test('offset pagination: page beyond the last returns an empty result with exact result_info', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    const beyond = await expectList(
      await app.request('/items?page=4&per_page=2&sort=email&order=asc'),
    );
    expect(beyond.result).toEqual([]);
    expect(beyond.result_info).toEqual({
      page: 4,
      per_page: 2,
      total_count: 5,
      total_pages: 3,
      has_next_page: false,
      has_prev_page: true,
    });
  });
}
