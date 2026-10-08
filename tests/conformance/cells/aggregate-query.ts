/**
 * Cell — Aggregate query params (`GET /items/aggregate`), issue #149.
 *
 * The aggregate query schema used to declare `limit`/`offset` as
 * `z.coerce.number()` and `withDeleted` as `z.coerce.boolean()`. The OpenAPI
 * validator therefore handed the parser numbers and booleans it did not
 * expect: `?limit=` was dropped, `?withDeleted=false` coerced to `true`, and
 * the unreserved `withDeleted` key fell through to the filters (memory
 * counted 0 rows; drizzle looked it up as a column). Pinned contract:
 *
 * - `?limit=` / `?offset=` page grouped results; `totalGroups` is the count
 *   before paging;
 * - `?orderBy=` sorts groups by an aggregate alias or a group key before
 *   paging (prisma's native `groupBy` included);
 * - `?count=<field>` counts non-null values under the `count<Field>` alias
 *   on every adapter, so `?orderBy=count<Field>` can sort by it;
 * - a non-integer or zero limit is `400 VALIDATION_ERROR`, one above `maxLimit` is
 *   `400 AGGREGATION_ERROR`;
 * - `?withDeleted=true` counts soft-deleted rows, `=false` (or absent) does
 *   not, and neither is ever treated as a filter.
 */
import { expect, test } from 'vitest';
import type { AdapterDescriptor, ConformanceRecord, CtxGetter } from '../contract';
import { createRecord, expectError, expectSuccess } from '../contract';
import { seedFilterRows } from '../model';

interface AggregateBody {
  values?: Record<string, number | null>;
  groups?: Array<{ key: Record<string, unknown>; values: Record<string, number | null> }>;
  totalGroups?: number;
}

export function registerAggregateQueryCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('aggregate: ?limit and ?offset page grouped results', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    // FILTER_SEED has three roles: admin, user, guest.
    const first = await expectSuccess<AggregateBody>(
      await app.request('/items/aggregate?count=*&groupBy=role&limit=1'),
      200,
    );
    expect(first.groups).toHaveLength(1);
    expect(first.totalGroups).toBe(3);

    const rest = await expectSuccess<AggregateBody>(
      await app.request('/items/aggregate?count=*&groupBy=role&limit=5&offset=1'),
      200,
    );
    expect(rest.groups).toHaveLength(2);
  });

  test('aggregate: ?orderBy sorts groups by an aggregate value or a group key before paging', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');

    const firstRole = async (query: string) =>
      (
        await expectSuccess<AggregateBody>(
          await app.request(`/items/aggregate?count=*&groupBy=role&limit=1${query}`),
          200,
        )
      ).groups?.[0]?.key.role;

    // Counts: admin 1, user 2, guest 2, so admin is the only unique extreme.
    expect(await firstRole('&orderBy=count&orderDirection=asc')).toBe('admin');
    // Group keys sort admin < guest < user.
    expect(await firstRole('&orderBy=role&orderDirection=desc')).toBe('user');
    expect(await firstRole('&orderBy=role&offset=1')).toBe('guest');
  });

  test('aggregate: ?count=<field> is keyed count<Field>, skips nulls, and sorts groups', async () => {
    const { app } = ctx();
    await seedFilterRows(app, '/items');
    // user ends with 3 rows and 3 ages, guest with 4 rows and 2 ages, so
    // counting rows instead of ages would put guest on top.
    for (const [name, role, age] of [
      ['Erin', 'user', 30],
      ['Finn', 'guest', null],
      ['Gail', 'guest', null],
    ] as const) {
      await createRecord(app, '/items', {
        name,
        email: `${name.toLowerCase()}@conformance.test`,
        role,
        age,
      });
    }

    const body = await expectSuccess<AggregateBody>(
      await app.request(
        '/items/aggregate?count=age&groupBy=role&orderBy=countAge&orderDirection=desc&limit=1',
      ),
      200,
    );
    expect(body.groups).toEqual([{ key: { role: 'user' }, values: { countAge: 3 } }]);
  });

  test('aggregate: a malformed or zero limit is 400 VALIDATION_ERROR, one above maxLimit is 400 AGGREGATION_ERROR', async () => {
    const { app } = ctx();
    await expectError(
      await app.request('/items/aggregate?count=*&limit=abc'),
      400,
      'VALIDATION_ERROR',
    );
    // A zero limit would page as "no limit", skipping defaultLimit and maxLimit.
    await expectError(
      await app.request('/items/aggregate?count=*&groupBy=role&limit=0'),
      400,
      'VALIDATION_ERROR',
    );
    await expectError(
      await app.request('/items/aggregate?count=*&groupBy=role&limit=5000'),
      400,
      'AGGREGATION_ERROR',
    );
  });

  test('aggregate: ?withDeleted=true counts soft-deleted rows, =false does not, and neither filters', async () => {
    const { app } = ctx();
    const byEmail = await seedFilterRows(app, '/items');
    const dave = byEmail.get('dave@conformance.test') as ConformanceRecord;
    expect((await app.request(`/items/${dave.id}`, { method: 'DELETE' })).status).toBe(200);

    const count = async (query: string) =>
      (
        await expectSuccess<AggregateBody>(
          await app.request(`/items/aggregate?count=*${query}`),
          200,
        )
      ).values?.count;

    expect(await count('')).toBe(4);
    expect(await count('&withDeleted=false')).toBe(4);
    expect(await count('&withDeleted=true')).toBe(5);
  });
}
