/**
 * Cell 2 — Per-operator filter matrix (audit findings 73/76; like/ilike
 * contract from finding 46).
 *
 * Pinned cross-adapter semantics:
 * - eq/ne/gt/gte/lt/lte/in behave identically regardless of how each adapter
 *   coerces query-string values.
 * - `like`  = case-SENSITIVE literal substring match on every adapter
 *   (memory strict `includes`; drizzle `INSTR`/`POSITION`/`LOCATE`;
 *   prisma `contains`).
 * - `ilike` = case-insensitive literal substring match on every adapter.
 * - User-supplied `%` is INERT — stripped before matching, never a SQL
 *   wildcard. User-supplied `_` is LITERAL — matched as the character itself.
 *   (`name[like]=100%` therefore matches every name containing "100";
 *   `name[like]=100_` matches nothing in the seed, because no name contains
 *   a literal "100_" and `_` must not act as a single-char wildcard.)
 */
import { expect, test } from 'vitest';
import type { AdapterDescriptor, CtxGetter } from '../contract';
import { expectList } from '../contract';
import { seedFilterRows } from '../model';

interface FilterCase {
  title: string;
  /** Query key exactly as core parses it (field or field[operator]). */
  key: string;
  value: string;
  /** Expected matching emails (order-insensitive). */
  expectEmails: readonly string[];
}

const ALICE = 'alice@conformance.test';
const COOPER = 'cooper@conformance.test';
const BOB = 'bob@conformance.test';
const CAROL = 'carol@conformance.test';
const DAVE = 'dave@conformance.test';

const FILTER_CASES: readonly FilterCase[] = [
  { title: 'eq', key: 'role[eq]', value: 'admin', expectEmails: [ALICE] },
  { title: 'eq (bare field=value form)', key: 'role', value: 'admin', expectEmails: [ALICE] },
  { title: 'ne', key: 'role[ne]', value: 'user', expectEmails: [ALICE, CAROL, DAVE] },
  { title: 'gt', key: 'age[gt]', value: '35', expectEmails: [CAROL, DAVE] },
  { title: 'gte', key: 'age[gte]', value: '35', expectEmails: [ALICE, CAROL, DAVE] },
  { title: 'lt', key: 'age[lt]', value: '28', expectEmails: [BOB] },
  { title: 'lte', key: 'age[lte]', value: '28', expectEmails: [BOB, COOPER] },
  { title: 'in', key: 'role[in]', value: 'admin,guest', expectEmails: [ALICE, CAROL, DAVE] },
  {
    title: 'like — literal substring, case-sensitive match',
    key: 'name[like]',
    value: 'lic',
    expectEmails: [ALICE, COOPER],
  },
  {
    title: 'like — case mismatch does not match (case-sensitive contract)',
    key: 'name[like]',
    value: 'ALI',
    expectEmails: [],
  },
  {
    title: 'like — user-supplied % is inert (stripped), never a wildcard',
    key: 'name[like]',
    value: '100%',
    expectEmails: [CAROL, DAVE],
  },
  {
    title: 'like — user-supplied _ is literal, never a single-char wildcard',
    key: 'name[like]',
    value: '100_',
    expectEmails: [],
  },
  {
    title: 'ilike — case-insensitive substring',
    key: 'name[ilike]',
    value: 'ALI',
    expectEmails: [ALICE, COOPER],
  },
  {
    title: 'ilike — user-supplied % is inert (stripped), never a wildcard',
    key: 'name[ilike]',
    value: '100%',
    expectEmails: [CAROL, DAVE],
  },
];

export function registerFilterOperatorCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  for (const filterCase of FILTER_CASES) {
    test(`filter operator ${filterCase.title}`, async () => {
      const { app } = ctx();
      await seedFilterRows(app, '/items');

      const query = new URLSearchParams({ [filterCase.key]: filterCase.value });
      const body = await expectList(await app.request(`/items?${query.toString()}`));

      const got = body.result.map((record) => record.email).sort();
      expect(got).toEqual([...filterCase.expectEmails].sort());
    });
  }
}
