/**
 * Cell — Sort tie-break: rows that tie on the sort column are ordered by the
 * primary key, in the sort direction, on every list-family verb.
 *
 * SQL engines leave the relative order of rows equal on the ORDER BY columns
 * unspecified, and every offset page is its own `ORDER BY … LIMIT … OFFSET`
 * statement — ordering by the sort column alone let a page walk repeat one
 * tied row and skip another (issue #142). The contract (drizzle
 * `executeDrizzleListQuery`, prisma `buildPrismaOrderBy`, memory
 * `compareByOrderThenKeys`):
 *
 * - `?sort=f&order=d` orders by `f d`, then the primary key `d` (the key is
 *   not repeated when it is itself the sort field);
 * - an offset walk over tied rows therefore visits every row exactly once,
 *   in (f, pk) order;
 * - the `order=desc` walk is the exact reverse of the `order=asc` walk;
 * - list, search, and export share that one total order.
 *
 * Ids are random UUIDs, so insertion order matches primary-key order only by
 * chance (1 in 6!·2! = 1440 for this seed): a leg that breaks ties by
 * insertion or scan order fails here.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceApp,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectList,
  expectSuccess,
  readJson,
} from '../contract';

const BASE = '/items';
const PER_PAGE = 3;

/** Six rows tie at age 30 and two at age 20. Identical names keep search scores equal. */
const TIE_AGES = [30, 20, 30, 30, 20, 30, 30, 30] as const;
const PAGE_COUNT = Math.ceil(TIE_AGES.length / PER_PAGE);

interface SearchEnvelope {
  success: true;
  result: Array<{ item: ConformanceRecord; score?: number }>;
}

interface ExportResult {
  data: ConformanceRecord[];
  count: number;
}

/** Seeds the tie rows and returns their ids in (age asc, id asc) order. */
async function seedTieRows(app: ConformanceApp): Promise<string[]> {
  const created: ConformanceRecord[] = [];
  for (const [index, age] of TIE_AGES.entries()) {
    created.push(
      await createRecord(app, BASE, {
        name: 'Tie Row',
        email: `tie-${index}@conformance.test`,
        role: 'user',
        age,
      }),
    );
  }
  return created
    .sort((a, b) => Number(a.age) - Number(b.age) || (a.id < b.id ? -1 : 1))
    .map((record) => record.id);
}

/** Concatenates pages 1..PAGE_COUNT of an offset walk. */
async function walkPages(fetchPage: (page: number) => Promise<string[]>): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= PAGE_COUNT; page++) {
    ids.push(...(await fetchPage(page)));
  }
  return ids;
}

export function registerSortTieBreakCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('sort tie-break: list offset walk orders tied rows by primary key; desc is the exact reverse', async () => {
    const { app } = ctx();
    const ascending = await seedTieRows(app);

    const listWalk = (order: 'asc' | 'desc') =>
      walkPages(async (page) => {
        const body = await expectList(
          await app.request(`${BASE}?sort=age&order=${order}&per_page=${PER_PAGE}&page=${page}`),
        );
        return body.result.map((record) => record.id);
      });

    expect(await listWalk('asc')).toEqual(ascending);
    expect(await listWalk('desc')).toEqual([...ascending].reverse());
  });

  test('sort tie-break: search offset walk uses the same (sort, primary key) order', async () => {
    const { app } = ctx();
    const ascending = await seedTieRows(app);

    const searchWalk = (order: 'asc' | 'desc') =>
      walkPages(async (page) => {
        const response = await app.request(
          `${BASE}/search?q=Tie&sort=age&order=${order}&per_page=${PER_PAGE}&page=${page}`,
        );
        expect(response.status).toBe(200);
        const body = await readJson<SearchEnvelope>(response);
        return body.result.map((hit) => hit.item.id);
      });

    expect(await searchWalk('asc')).toEqual(ascending);
    expect(await searchWalk('desc')).toEqual([...ascending].reverse());
  });

  test('sort tie-break: export uses the same (sort, primary key) order', async () => {
    const { app } = ctx();
    const ascending = await seedTieRows(app);

    const exportIds = async (order: 'asc' | 'desc') => {
      const result = await expectSuccess<ExportResult>(
        await app.request(`${BASE}/export?format=json&sort=age&order=${order}`),
        200,
      );
      expect(result.count).toBe(TIE_AGES.length);
      return result.data.map((record) => record.id);
    };

    expect(await exportIds('asc')).toEqual(ascending);
    expect(await exportIds('desc')).toEqual([...ascending].reverse());
  });
}
