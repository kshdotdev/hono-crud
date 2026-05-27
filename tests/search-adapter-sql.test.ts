/**
 * Tests for adapter-layer search fixes:
 *
 *   1. LIKE wildcard escape — user `%` and `_` must be treated as literals
 *      (security/hardening: prevents abuse-vector probing/exfiltration).
 *   2. mode='all' token-AND semantics — each token must appear in AT LEAST
 *      ONE configured field, not the whole phrase in EVERY field.
 *
 * Covers drizzle (real libsql/SQLite table) and the in-memory adapter.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { defineModel } from 'hono-crud';
import {
  DrizzleSearchEndpoint,
  type DrizzleDatabase,
} from '@hono-crud/drizzle';
import {
  MemorySearchEndpoint,
  clearStorage,
  getStorage,
} from '@hono-crud/memory';

// ============================================================================
// Shared fixture model
// ============================================================================

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deletedAt: z.string().nullable().optional(),
});

// ============================================================================
// Drizzle setup (libsql / in-memory SQLite)
// ============================================================================

const productsTable = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  deletedAt: text('deletedAt'),
});

const drizzleClient = createClient({ url: ':memory:' });
const drizzleDb = drizzle(drizzleClient);

const DrizzleProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
  table: productsTable,
  softDelete: { field: 'deletedAt' },
});

class DrizzleProductSearch extends DrizzleSearchEndpoint {
  _meta = { model: DrizzleProductModel };
  db = drizzleDb as unknown as DrizzleDatabase;
  schema = { tags: ['Products'], summary: 'Search products' };

  protected searchFields = ['name', 'description'];
  protected minQueryLength = 2;
}

// ============================================================================
// Memory setup (separate model so it doesn't collide with drizzle storage)
// ============================================================================

const MemoryProductModel = defineModel({
  tableName: 'memory_products',
  schema: ProductSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
});

class MemoryProductSearch extends MemorySearchEndpoint {
  _meta = { model: MemoryProductModel };
  schema = { tags: ['Products'], summary: 'Search products' };

  protected searchFields = ['name', 'description'];
  protected minQueryLength = 2;
}

// ============================================================================
// Fixture rows
// ============================================================================

/**
 * Rows chosen to exercise BOTH fixes simultaneously:
 *  - "orbit"      : multi-field token-AND target — name has "Orbit Desk Light",
 *                   description has "warm/cool" and "USB-C charger".
 *  - "wildcard_%" : literal `_` and `%` in the user-visible name/description
 *                   to verify they are not treated as LIKE wildcards.
 *  - "percent"    : control row to confirm `q=%%` does NOT match every row.
 *  - "foo_bar"    : control row with literal `foo_bar` to verify `_` escape.
 *  - "fooXbar"    : control row that WOULD match `foo_bar` if `_` leaked as
 *                   a single-char wildcard. Must NOT match post-fix.
 */
const ROWS = [
  {
    id: 'r1',
    name: 'Orbit Desk Light',
    description: 'Adjustable warm/cool LED with USB-C charger.',
  },
  {
    id: 'r2',
    name: 'Literal foo_bar widget',
    description: 'Contains the exact characters foo_bar in the name.',
  },
  {
    id: 'r3',
    name: 'fooXbar device',
    description: 'No underscore in name; would match if _ leaked as wildcard.',
  },
  {
    id: 'r4',
    name: '50% off sticker',
    description: 'Promotional sticker with a literal percent sign.',
  },
  {
    id: 'r5',
    name: 'Plain item',
    description: 'No special characters or matching tokens at all.',
  },
  {
    id: 'r6',
    name: 'Warm cushion',
    description: 'Cozy fabric cushion in warm earth tones.',
  },
];

// ============================================================================
// Helpers
// ============================================================================

interface SearchResponse {
  success: boolean;
  result: Array<{ item: { id: string; name: string; description: string } }>;
  result_info: { total_count: number; query: string };
}

async function parseSearch(
  response: Response
): Promise<{ ids: string[]; totalCount: number }> {
  expect(response.status).toBe(200);
  const data = (await response.json()) as SearchResponse;
  expect(data.success).toBe(true);
  return {
    ids: data.result.map((r) => r.item.id).sort(),
    totalCount: data.result_info.total_count,
  };
}

async function ids(response: Response): Promise<string[]> {
  return (await parseSearch(response)).ids;
}

// ============================================================================
// Drizzle suite
// ============================================================================

describe('Drizzle search adapter — LIKE wildcard escape', () => {
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
    app.get('/products/search', async (c) => {
      const endpoint = new DrizzleProductSearch();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it('treats user `_` as literal — q=foo_bar matches only literal "foo_bar"', async () => {
    const response = await app.request('/products/search?q=foo_bar');
    const { ids: matched, totalCount } = await parseSearch(response);

    // Must include r2 (literal foo_bar in name + description).
    expect(matched).toContain('r2');
    // Must NOT include r3 (would only match if `_` leaked as a wildcard).
    expect(matched).not.toContain('r3');
    // SQL-level leak guard: total_count comes from `count(*)` BEFORE the
    // in-memory rescorer drops false positives. Pre-fix the SQL matched
    // both r2 and r3 (because `_` was a wildcard), so total_count was 2.
    // Post-fix the SQL matches exactly r2 → total_count is 1.
    expect(totalCount).toBe(1);
  });

  it('treats user `%%` as literal — q=%% matches zero rows', async () => {
    const response = await app.request('/products/search?q=%25%25');
    const { ids: matched, totalCount } = await parseSearch(response);

    expect(matched).toEqual([]);
    // SQL-level leak guard: pre-fix `q=%%` returns every row from the SQL
    // count (total_count === 6). Post-fix it returns 0.
    expect(totalCount).toBe(0);
  });

  it('treats user `%` as literal — q=50% matches only the literal "50%" row', async () => {
    const response = await app.request('/products/search?q=50%25');
    const { ids: matched, totalCount } = await parseSearch(response);

    expect(matched).toContain('r4');
    // Must NOT include r5 (the plain item — no `%` and no '50' in it).
    expect(matched).not.toContain('r5');
    // SQL-level leak guard.
    expect(totalCount).toBe(1);
  });
});

describe("Drizzle search adapter — mode='all' token-AND semantics", () => {
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
    app.get('/products/search', async (c) => {
      const endpoint = new DrizzleProductSearch();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it("q='warm cool' mode='all' matches the Orbit row (token-AND across fields)", async () => {
    const response = await app.request(
      '/products/search?q=warm%20cool&mode=all'
    );
    const matched = await ids(response);

    // r1 description contains both "warm" and "cool" (in "warm/cool").
    // The pre-fix per-field-AND would never match this since no single field
    // contains the literal phrase "warm cool".
    expect(matched).toContain('r1');
    // r6 has "warm" but not "cool" — must be excluded.
    expect(matched).not.toContain('r6');
  });

  it("q='warm zzzz' mode='all' returns 0 (negative case)", async () => {
    const response = await app.request(
      '/products/search?q=warm%20zzzz&mode=all'
    );
    const matched = await ids(response);

    expect(matched).toEqual([]);
  });

  it("mode='any' (default) preserves phrase OR'd across fields", async () => {
    const response = await app.request(
      '/products/search?q=warm%20cool&mode=any'
    );
    const matched = await ids(response);

    // 'any' mode keeps the legacy semantics: full phrase OR'd across fields.
    // No row has the LITERAL string "warm cool" anywhere, so the SQL
    // pre-filter returns 0 rows. This documents the pre-existing behavior.
    expect(matched).toEqual([]);
  });

  it("mode='phrase' matches the literal phrase 'warm/cool'", async () => {
    const response = await app.request(
      '/products/search?q=warm%2Fcool&mode=phrase'
    );
    const matched = await ids(response);

    expect(matched).toContain('r1');
  });

  it("mode='phrase' does NOT match the non-existent phrase 'warm cool'", async () => {
    const response = await app.request(
      '/products/search?q=warm%20cool&mode=phrase'
    );
    const matched = await ids(response);

    expect(matched).not.toContain('r1');
  });
});

// ============================================================================
// Memory suite
// ============================================================================

describe('Memory search adapter — LIKE wildcard semantics (literal chars)', () => {
  let app: Hono;

  beforeEach(() => {
    clearStorage();
    const store = getStorage<Record<string, unknown>>('memory_products');
    for (const row of ROWS) {
      store.set(row.id, row);
    }

    app = new Hono();
    app.onError((err, c) =>
      c.json({ success: false, error: { message: err.message } }, 400)
    );
    app.get('/products/search', async (c) => {
      const endpoint = new MemoryProductSearch();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it('treats `_` as literal — q=foo_bar matches only the literal row', async () => {
    const response = await app.request('/products/search?q=foo_bar');
    const matched = await ids(response);

    expect(matched).toContain('r2');
    expect(matched).not.toContain('r3');
  });

  it('treats `%%` as literal — q=%% matches zero rows', async () => {
    const response = await app.request('/products/search?q=%25%25');
    const matched = await ids(response);

    expect(matched).toEqual([]);
  });
});

describe("Memory search adapter — mode='all' token-AND semantics", () => {
  let app: Hono;

  beforeEach(() => {
    clearStorage();
    const store = getStorage<Record<string, unknown>>('memory_products');
    for (const row of ROWS) {
      store.set(row.id, row);
    }

    app = new Hono();
    app.onError((err, c) =>
      c.json({ success: false, error: { message: err.message } }, 400)
    );
    app.get('/products/search', async (c) => {
      const endpoint = new MemoryProductSearch();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it("q='warm cool' mode='all' matches the Orbit row (token-AND across fields)", async () => {
    const response = await app.request(
      '/products/search?q=warm%20cool&mode=all'
    );
    const matched = await ids(response);

    expect(matched).toContain('r1');
    expect(matched).not.toContain('r6');
  });

  it("q='warm zzzz' mode='all' returns 0 (negative case)", async () => {
    const response = await app.request(
      '/products/search?q=warm%20zzzz&mode=all'
    );
    const matched = await ids(response);

    expect(matched).toEqual([]);
  });
});
