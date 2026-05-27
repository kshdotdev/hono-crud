/**
 * Tests for the drizzle list endpoint's `?search=` shorthand:
 *
 *   1. User `%` and `_` are treated as literal characters — they must NOT
 *      behave as LIKE wildcards. This closes a consistency gap with the
 *      memory and Prisma list adapters (which use literal `.includes()` /
 *      Prisma `contains`) and with the dedicated drizzle search endpoint
 *      (which switched to dialect-native substring functions in PR-I).
 *   2. The dialect plumbing wired through `createDrizzleCrud(... , { dialect })`
 *      reaches the List endpoint, so list `?search=` emits the same
 *      dialect-native substring function (`INSTR`/`POSITION`/`LOCATE`) as
 *      the dedicated search endpoint.
 *
 * The behavioral tests run against a real libsql/SQLite table — same fixture
 * pattern as `search-adapter-sql.test.ts`. The dialect-emission tests use a
 * stub `db` that captures the generated `where(...)` SQL without needing a
 * real driver for each dialect.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { defineModel, defineMeta } from 'hono-crud';
import {
  createDrizzleCrud,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '@hono-crud/drizzle';

// ============================================================================
// Shared fixture model
// ============================================================================

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deletedAt: z.string().nullable().optional(),
});

const productsTable = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  deletedAt: text('deletedAt'),
});

const drizzleClient = createClient({ url: ':memory:' });
const drizzleDb = drizzle(drizzleClient);

const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
  table: productsTable,
  softDelete: { field: 'deletedAt' },
});

class ProductList extends DrizzleListEndpoint {
  _meta = { model: ProductModel };
  db = drizzleDb as unknown as DrizzleDatabase;
  schema = { tags: ['Products'], summary: 'List products' };

  protected searchFields = ['name', 'description'];
}

// Fixture rows chosen to exercise wildcard-literal semantics. Mirrors the
// pattern used by `search-adapter-sql.test.ts` so the two adapter sites are
// observably equivalent end-to-end.
//
//  - "foo_bar"  : literal `_` to verify it is NOT a single-char wildcard.
//  - "fooXbar"  : would match `foo_bar` ONLY if `_` leaked as a wildcard.
//                 Must not match post-fix.
//  - "50%"      : literal `%` in the row's display name; verifies `%` is
//                 not the LIKE multi-char wildcard.
//  - "Plain"    : control row; q=%% must not match it.
const ROWS = [
  {
    id: 'r1',
    name: 'Literal foo_bar widget',
    description: 'Contains the exact characters foo_bar in the name.',
  },
  {
    id: 'r2',
    name: 'fooXbar device',
    description: 'No underscore in name; would match if _ leaked as wildcard.',
  },
  {
    id: 'r3',
    name: '50% off sticker',
    description: 'Promotional sticker with a literal percent sign.',
  },
  {
    id: 'r4',
    name: 'Plain item',
    description: 'No special characters or matching tokens at all.',
  },
];

interface ListResponse {
  success: boolean;
  result: Array<{ id: string; name: string; description: string }>;
  result_info: { total_count: number };
}

async function parseList(
  response: Response
): Promise<{ ids: string[]; totalCount: number }> {
  expect(response.status).toBe(200);
  const data = (await response.json()) as ListResponse;
  return {
    ids: data.result.map((r) => r.id).sort(),
    totalCount: data.result_info.total_count,
  };
}

// ============================================================================
// Behavioral suite — real libsql/SQLite
// ============================================================================

describe('Drizzle list adapter — ?search= literal substring semantics', () => {
  let app: Hono;

  beforeAll(async () => {
    await drizzleDb.run(sql`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        deletedAt TEXT
      )
    `);
  });

  beforeEach(async () => {
    await drizzleDb.delete(productsTable);
    for (const row of ROWS) {
      await drizzleDb.insert(productsTable).values(row);
    }

    app = new Hono();
    app.onError((err, c) =>
      c.json({ success: false, error: { message: err.message } }, 400)
    );
    app.get('/products', async (c) => {
      const endpoint = new ProductList();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it('treats user `_` as literal — search=foo_bar matches only literal "foo_bar"', async () => {
    const response = await app.request('/products?search=foo_bar');
    const { ids: matched, totalCount } = await parseList(response);

    // Must include r1 (literal foo_bar in name + description).
    expect(matched).toContain('r1');
    // Must NOT include r2 — it would only match if `_` leaked as a wildcard.
    expect(matched).not.toContain('r2');
    // SQL-level guard: total_count is the COUNT(*) of the same WHERE clause,
    // so it directly evidences what matched in SQL. Pre-fix r2 would also
    // match (total_count >= 2); post-fix only r1 matches.
    expect(totalCount).toBe(1);
  });

  it('treats user `%%` as literal — search=%% matches zero rows', async () => {
    // `%25%25` is URL-encoded `%%`. Pre-fix this expanded to
    // `LOWER(col) LIKE LOWER('%%%%')` (collapsed by LIKE to the universal
    // "any" pattern) and matched every row. Post-fix it must match only
    // rows that literally contain "%%" — none of the fixture rows do.
    const response = await app.request('/products?search=%25%25');
    const { ids: matched, totalCount } = await parseList(response);

    expect(matched).toEqual([]);
    expect(totalCount).toBe(0);
  });

  it('treats user `%` as literal — search=50% matches only the literal "50%" row', async () => {
    const response = await app.request('/products?search=50%25');
    const { ids: matched, totalCount } = await parseList(response);

    // r3 has the literal "50%" in its name.
    expect(matched).toContain('r3');
    // r4 ("Plain item") must NOT match — it has neither "50" nor "%".
    expect(matched).not.toContain('r4');
    expect(totalCount).toBe(1);
  });

  it('preserves case-insensitive matching — search=FOO_BAR still finds the literal row', async () => {
    // The substring helper wraps both sides in LOWER(), so case-insensitive
    // behavior is unchanged from the previous LIKE+LOWER approach.
    const response = await app.request('/products?search=FOO_BAR');
    const { ids: matched } = await parseList(response);

    expect(matched).toContain('r1');
    expect(matched).not.toContain('r2');
  });
});

// ============================================================================
// Dialect-emission suite — verifies factory wiring + per-dialect SQL
// ============================================================================
//
// Mirrors the `substringMatch` emission tests in `drizzle-dialect.test.ts`,
// but exercises the LIST endpoint's `?search=` path end-to-end so we observe
// that:
//   (a) `createDrizzleCrud(... , { dialect })` plumbs the dialect into the
//       anonymous List subclass (factory wiring); AND
//   (b) the List endpoint actually emits the right substring function for
//       that dialect (correct call site inside the class).
//
// A stub db captures the `where(...)` SQL fragment so we can assert on the
// emitted function name without needing a real pg/mysql driver.

interface WhereCapture {
  whereSql: ReturnType<typeof sql> | undefined;
}

/**
 * Recursively walks a drizzle SQL tree and concatenates every literal string
 * fragment. The list endpoint builds its WHERE via `or(...substringMatch(...))`
 * — so the captured SQL is a wrapper around N substring-match nodes, each of
 * which has its own nested `queryChunks`. Bound parameters and column refs
 * are skipped — we only care about the literal SQL function/keyword tokens.
 *
 * Mirrors the literal-extraction strategy in `drizzle-dialect.test.ts`, but
 * walks recursively to handle the nested structure produced when the WHERE
 * is composed by the list endpoint rather than emitted directly by the
 * `substringMatch` helper.
 */
function literalChunks(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return '';
  if (typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  // Leaf string-fragment chunk shape: `{ value: ['...'] }`.
  if ('value' in obj && Array.isArray(obj.value)) {
    return (obj.value as unknown[]).filter((v) => typeof v === 'string').join('');
  }
  // Composite SQL node: `{ queryChunks: [...] }`.
  if ('queryChunks' in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).map(literalChunks).join('');
  }
  return '';
}

/**
 * Builds a stub Drizzle database that captures the `where(...)` SQL passed
 * to the count and main query. Returns a no-op chain for the rest so the
 * list endpoint can run end-to-end without a real driver.
 */
function makeWhereCaptureDb(): { db: DrizzleDatabase; capture: WhereCapture } {
  const capture: WhereCapture = { whereSql: undefined };

  const countChain = {
    from() {
      return {
        where(s: unknown) {
          capture.whereSql = s as ReturnType<typeof sql>;
          return Promise.resolve([{ count: 0 }]);
        },
      };
    },
  };

  // Main query is a thenable chain: select().from().where().orderBy().limit().offset()
  const mainChain: Record<string, (...args: unknown[]) => unknown> = {};
  mainChain.where = (s: unknown) => {
    capture.whereSql = s as ReturnType<typeof sql>;
    return mainChain;
  };
  mainChain.orderBy = () => mainChain;
  mainChain.limit = () => mainChain;
  mainChain.offset = () => mainChain;
  // Make it thenable so `await query` resolves to an empty array.
  (mainChain as unknown as PromiseLike<unknown[]>).then = (
    onFulfilled?: (value: unknown[]) => unknown
  ) => Promise.resolve([]).then(onFulfilled);

  const db = {
    select(fields?: Record<string, unknown>) {
      // The count call passes `{ count: sql<number>\`count(*)\` }`; the main
      // query call passes no fields. Branch on that to return the right shape.
      if (fields) {
        return countChain;
      }
      return {
        from() {
          return mainChain;
        },
      };
    },
    insert() {
      return mainChain;
    },
    update() {
      return mainChain;
    },
    delete() {
      return mainChain;
    },
    transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(db);
    },
  } as unknown as DrizzleDatabase;

  return { db, capture };
}

// Stub-friendly model: no `table` reference is needed because the stub `db`
// never inspects it, but `getTable`/`getColumn` need *something*. We feed the
// real sqlite table to keep the column-resolution path honest.
const stubProductsTable = sqliteTable('stub_products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

const StubProductSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const StubProductModel = defineModel({
  tableName: 'stub_products',
  schema: StubProductSchema,
  primaryKeys: ['id'],
  table: stubProductsTable,
});

const stubProductMeta = defineMeta({ model: StubProductModel });

async function runListWithSearch(
  ListCls: new () => DrizzleListEndpoint,
  needle: string
): Promise<void> {
  class ProbeList extends ListCls {
    // The base class reads `searchFields` from the instance — declaring it
    // here is enough to drive the `?search=` branch inside `list(...)`.
    protected searchFields = ['name'];
  }

  const app = new Hono();
  app.onError((err, c) =>
    c.json({ success: false, error: { message: err.message } }, 400)
  );
  app.get('/items', async (c) => {
    const endpoint = new ProbeList();
    endpoint.setContext(c);
    return endpoint.handle();
  });

  const response = await app.request(
    `/items?search=${encodeURIComponent(needle)}`
  );
  // We only care that the request executed enough to capture the WHERE SQL.
  // The stub's empty result is fine; the endpoint completes with a 200.
  expect(response.status).toBe(200);
}

describe('Drizzle list adapter — dialect-native ?search= SQL emission', () => {
  it("sqlite (default) emits INSTR(LOWER(col), LOWER(needle)) > 0", async () => {
    const { db, capture } = makeWhereCaptureDb();
    const Product = createDrizzleCrud(db, stubProductMeta);

    await runListWithSearch(Product.List, 'foo');

    const text = literalChunks(capture.whereSql);
    expect(text).toContain('INSTR(');
    expect(text).toContain('> 0');
    expect(text).not.toContain('POSITION(');
    expect(text).not.toContain('LOCATE(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });

  it("pg emits POSITION(LOWER(needle) IN LOWER(col)) > 0", async () => {
    const { db, capture } = makeWhereCaptureDb();
    const Product = createDrizzleCrud(db, stubProductMeta, { dialect: 'pg' });

    await runListWithSearch(Product.List, 'foo');

    const text = literalChunks(capture.whereSql);
    expect(text).toContain('POSITION(');
    expect(text).toContain(' IN ');
    expect(text).toContain('> 0');
    expect(text).not.toContain('INSTR(');
    expect(text).not.toContain('LOCATE(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });

  it("mysql emits LOCATE(LOWER(needle), LOWER(col)) > 0", async () => {
    const { db, capture } = makeWhereCaptureDb();
    const Product = createDrizzleCrud(db, stubProductMeta, { dialect: 'mysql' });

    await runListWithSearch(Product.List, 'foo');

    const text = literalChunks(capture.whereSql);
    expect(text).toContain('LOCATE(');
    expect(text).toContain('> 0');
    expect(text).not.toContain('INSTR(');
    expect(text).not.toContain('POSITION(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });

  it('a subclass that does not set dialect inherits the "sqlite" default', async () => {
    const { db, capture } = makeWhereCaptureDb();

    class InheritList extends DrizzleListEndpoint {
      _meta = stubProductMeta;
      db = db;
      // No override — should default to 'sqlite'.
      protected searchFields = ['name'];
    }

    const app = new Hono();
    app.onError((err, c) =>
      c.json({ success: false, error: { message: err.message } }, 400)
    );
    app.get('/items', async (c) => {
      const endpoint = new InheritList();
      endpoint.setContext(c);
      return endpoint.handle();
    });

    const response = await app.request('/items?search=foo');
    expect(response.status).toBe(200);

    const text = literalChunks(capture.whereSql);
    expect(text).toContain('INSTR(');
    expect(text).not.toContain('POSITION(');
    expect(text).not.toContain('LOCATE(');
  });
});
