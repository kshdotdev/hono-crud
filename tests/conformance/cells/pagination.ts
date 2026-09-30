/**
 * Cell 3 — Offset pagination: page/per_page walk + exact result_info shape.
 *
 * `result_info` is built independently inside each adapter
 * (memory crud.ts, drizzle crud.ts, prisma helpers.buildPaginatedResult);
 * this cell pins the canonical 6-field shape from core
 * (PaginatedResult.result_info) so the three implementations cannot drift.
 *
 * `page` / `per_page` validate against the bounds the OpenAPI document
 * states (integer, min 1, `per_page` max `maxPerPage`): a value outside them
 * is refused with 400 VALIDATION_ERROR, never clamped.
 */
import { expect, test } from 'vitest';
import type { AdapterDescriptor, CtxGetter, ResultInfo } from '../contract';
import { expectError, expectList, readJson } from '../contract';
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

  test('offset pagination: absent page/per_page answer page 1 at the default page size', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    const list = await expectList(await app.request('/items'));
    expect(list.result_info).toMatchObject({ page: 1, per_page: 20, total_count: 5 });
  });

  test('offset pagination: a defaultPerPage above maxPerPage defaults to the ceiling', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/capped-items');

    const list = await expectList(await app.request('/capped-items'));
    expect(list.result).toHaveLength(2);
    expect(list.result_info).toMatchObject({ page: 1, per_page: 2, total_count: 5 });
  });

  test('offset pagination: page/per_page outside the documented bounds are refused, never clamped', async () => {
    const { app } = ctx();

    for (const query of [
      'per_page=101',
      'per_page=0',
      'per_page=abc',
      'per_page=2.5',
      'per_page=',
      'page=0',
      'page=abc',
      'page=',
    ]) {
      await expectError(await app.request(`/items?${query}`), 400, 'VALIDATION_ERROR');
    }

    const ceiling = await expectList(await app.request('/items?per_page=100'));
    expect(ceiling.result_info.per_page).toBe(100);
  });

  test('offset pagination: export neither honors nor validates page/per_page', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    // per_page=1 would cut the export to one row if honored; page=0 would 400 if validated.
    const response = await app.request('/items/export?per_page=1&page=0');
    expect(response.status).toBe(200);
    const body = await readJson<{ result: { count: number } }>(response);
    expect(body.result.count).toBe(5);
  });

  test('offset pagination: search refuses page/per_page outside the documented bounds', async () => {
    const { app } = ctx();

    for (const query of ['per_page=101', 'per_page=0', 'per_page=abc', 'per_page=', 'page=0']) {
      await expectError(await app.request(`/items/search?q=a&${query}`), 400, 'VALIDATION_ERROR');
    }
  });
}
