import { DrizzleCloneEndpoint, type DrizzleDatabaseConstraint } from '@hono-crud/drizzle';
import {
  MemoryBatchCreateEndpoint,
  MemoryCloneEndpoint,
  MemoryImportEndpoint,
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Hono } from 'hono';
import {
  defineMeta,
  defineModel,
  fromHono,
  mapUniqueViolation,
  stripManagedInsertFields,
} from 'hono-crud';
/**
 * Managed-field coverage gaps closed in 0.12.2 (follow-up to 0.12.1).
 *
 * 0.12.1 centralized `getManagedInputExclusions` /
 * `applyManagedInsertFields` / `applyManagedUpdateFields` and applied
 * them to single create, batch create, update, batch update, upsert,
 * batch upsert and clone — but four follow-up gaps stayed open:
 *
 *  1. `import` per-row validation still forced the engine-managed
 *     fields, so a minimal import body errored with
 *     `validationErrors:[items.0.createdAt: undefined, …]`.
 *  2. `clone` copied the source row's `createdAt` / `updatedAt` into
 *     the new row instead of letting `applyManagedInsertFields` stamp
 *     fresh values.
 *  3. `clone` without a slug override surfaced the adapter's UNIQUE
 *     violation as a plaintext 500 instead of the engine's standard
 *     `{success:false, error:{code:"CONFLICT", …}}` 409 envelope.
 *  4. `batch-create`'s model-derived item schema must keep every
 *     `ZodDefault` wrapper so an item that omits a defaulted field
 *     still parses (the engine should apply the default).
 *
 * All four are the same theme — managed-fields coverage — so they land
 * together. The existing 0.12.0 / 0.12.1 tests (managed-id-timestamps,
 * managed-fields-input-schema) stay green; this file covers only the
 * follow-up surface.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Schemas / app helpers
// ============================================================================

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  priceCents: z.number(),
  currency: z.string().default('USD'),
  stock: z.number().default(0),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
type Product = z.infer<typeof ProductSchema>;

function memoryProductsApp() {
  const model = defineModel({
    tableName: 'mfc_products',
    schema: ProductSchema,
    primaryKeys: ['id'],
    timestamps: true,
  });
  const meta = defineMeta({ model });

  class ProductImport extends MemoryImportEndpoint<any, typeof meta> {
    _meta = meta;
    protected upsertKeys = ['slug'];
    // No `optionalImportFields` => proves the managed-field exclusion
    // (not `optionalImportFields`) is what makes the minimal row pass.
    async create(data: any) {
      // Re-use the adapter's create path so engine-managed fields are stamped.
      const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory');
      const store = getStore<Product>('mfc_products');
      store.set(String((record as any).id), record as Product);
      return record as Product;
    }
    async update(existing: Product, data: any) {
      const store = getStore<Product>('mfc_products');
      const merged = { ...existing, ...data, updatedAt: Date.now() } as Product;
      store.set(existing.id, merged);
      return merged;
    }
    async findExisting(data: any) {
      const store = getStore<Product>('mfc_products');
      for (const v of store.values()) {
        if (v.slug === data.slug) return v;
      }
      return null;
    }
  }
  class ProductClone extends MemoryCloneEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ProductBatch extends MemoryBatchCreateEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ProductCreate extends MemoryImportEndpoint<any, typeof meta> {
    // Only used to seed the store in tests; never registered.
    _meta = meta;
    async create(data: any) {
      const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory');
      const store = getStore<Product>('mfc_products');
      store.set(String((record as any).id), record as Product);
      return record as Product;
    }
    async update() {
      throw new Error('unused');
    }
    async findExisting() {
      return null;
    }
  }

  const app = fromHono(new Hono());
  app.onError((err, c) => c.json({ error: { message: err.message } }, 500));
  app.post('/products/import', ProductImport as any);
  app.post('/products/batch', ProductBatch as any);
  app.post('/products/:id/clone', ProductClone as any);
  return { app, meta, ProductImport, ProductClone, ProductBatch, ProductCreate };
}

// ============================================================================
// 1. Import strip — engine-managed fields excluded from the import schema
// ============================================================================

describe('import strip: engine-managed fields excluded from per-row validation', () => {
  beforeEach(() => clearStorage());

  it('minimal item (no id/createdAt/updatedAt) imports successfully', async () => {
    const { app } = memoryProductsApp();
    const res = await app.request('/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ name: 'A', slug: 'a', priceCents: 100, currency: 'USD', stock: 0 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        summary: { created: number; skipped: number; failed: number; total: number };
        results: Array<{ status: string; data?: Product; validationErrors?: unknown }>;
      };
    };
    expect(body.result.summary.created).toBe(1);
    expect(body.result.summary.skipped).toBe(0);
    expect(body.result.summary.failed).toBe(0);
    const row = body.result.results[0];
    expect(row.status).toBe('created');
    // Engine-stamped fields surfaced on the created record.
    expect(typeof row.data?.id).toBe('string');
    expect(typeof row.data?.createdAt).toBe('number');
    expect(typeof row.data?.updatedAt).toBe('number');
    // No validationErrors for the managed fields.
    expect(row.validationErrors).toBeUndefined();
  });

  it('per-row schema excludes id/createdAt/updatedAt (matches getManagedInputExclusions)', () => {
    const { ProductImport, meta } = memoryProductsApp();
    const inst = new ProductImport();
    (inst as any)._meta = meta;
    const schema = (inst as any).getImportSchema() as z.ZodTypeAny;
    const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    // The items array's element schema must not contain the managed names.
    const text = JSON.stringify(js);
    expect(text).not.toContain('"id"');
    expect(text).not.toContain('"createdAt"');
    expect(text).not.toContain('"updatedAt"');
    // Non-managed fields are kept.
    expect(text).toContain('"slug"');
    expect(text).toContain('"priceCents"');
  });
});

// ============================================================================
// 2. Clone fresh-stamping — new record gets engine-fresh id + timestamps
// ============================================================================

describe('clone fresh-stamping: timestamps + id are engine-fresh, not copied from source', () => {
  beforeEach(() => clearStorage());

  it('cloned row has fresh createdAt/updatedAt and a fresh id', async () => {
    const { app } = memoryProductsApp();

    // Seed directly into the in-memory store with an old timestamp so a
    // copy-vs-stamp difference is unambiguous.
    const sourceCreatedAt = 1_000;
    const store = getStore<Product>('mfc_products');
    store.set('src-1', {
      id: 'src-1',
      name: 'Source',
      slug: 'source',
      priceCents: 100,
      currency: 'USD',
      stock: 0,
      createdAt: sourceCreatedAt,
      updatedAt: sourceCreatedAt,
    } as Product);

    const before = Date.now();
    const res = await app.request('/products/src-1/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'clone-1' }),
    });
    const after = Date.now();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: Product };
    expect(body.result.id).not.toBe('src-1');
    expect(body.result.slug).toBe('clone-1');
    // Stamped fresh — not equal to the source's timestamps.
    expect(body.result.createdAt).not.toBe(sourceCreatedAt);
    expect(body.result.updatedAt).not.toBe(sourceCreatedAt);
    // Stamped between the request's bracket times.
    expect(body.result.createdAt!).toBeGreaterThanOrEqual(before);
    expect(body.result.createdAt!).toBeLessThanOrEqual(after);
    expect(body.result.updatedAt!).toBeGreaterThanOrEqual(before);
    expect(body.result.updatedAt!).toBeLessThanOrEqual(after);
  });

  it('stripManagedInsertFields removes id + (resolved) timestamps from the source row', () => {
    const out = stripManagedInsertFields(
      {
        id: 'x',
        createdAt: 1,
        updatedAt: 2,
        name: 'keep',
        slug: 'keep',
      } as Record<string, unknown>,
      { primaryKeys: ['id'], id: 'uuid', timestamps: true },
    );
    expect('id' in out).toBe(false);
    expect('createdAt' in out).toBe(false);
    expect('updatedAt' in out).toBe(false);
    expect(out.name).toBe('keep');
    expect(out.slug).toBe('keep');
  });

  it('stripManagedInsertFields resolves the renamed timestamp names', () => {
    const out = stripManagedInsertFields(
      { id: 'x', made_at: 1, touched_at: 2, name: 'keep' } as Record<string, unknown>,
      {
        primaryKeys: ['id'],
        id: 'uuid',
        timestamps: { createdAt: 'made_at', updatedAt: 'touched_at' },
      },
    );
    expect('made_at' in out).toBe(false);
    expect('touched_at' in out).toBe(false);
    expect(out.name).toBe('keep');
  });
});

// ============================================================================
// 3. Clone slug-collision → 409 JSON envelope (drizzle adapter)
// ============================================================================

describe('clone unique-violation → 409 JSON envelope', () => {
  // Memory adapter has no UNIQUE constraint, so use a real SQLite via
  // libsql/drizzle to exercise the actual `UNIQUE constraint failed`
  // error → 409 mapping.
  const products = sqliteTable('mfc_products_drizzle', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    priceCents: integer('price_cents').notNull(),
  });
  const Schema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    priceCents: z.number(),
  });
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  const model = defineModel({
    tableName: 'mfc_products_drizzle',
    schema: Schema,
    primaryKeys: ['id'],
    table: products,
  });
  const meta = defineMeta({ model });

  class ProdClone extends DrizzleCloneEndpoint<any, typeof meta> {
    _meta = meta;
    db = db as unknown as DrizzleDatabaseConstraint;
  }

  let app: Hono;

  beforeAll(async () => {
    await db.run(
      sql`CREATE TABLE IF NOT EXISTS mfc_products_drizzle (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, price_cents INTEGER NOT NULL)`,
    );
  });

  beforeEach(async () => {
    await db.delete(products);
    app = fromHono(new Hono());
    app.post('/products/:id/clone', ProdClone as any);
    await db.insert(products).values({
      id: 'p-1',
      name: 'P',
      slug: 'p-slug',
      priceCents: 100,
    });
  });

  it('clone with no slug override → 409 + standard error envelope (drizzle)', async () => {
    const res = await app.request('/products/p-1/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(typeof body.error.message).toBe('string');
  });

  it('clone with a distinct slug override succeeds (regression — only collisions 409)', async () => {
    const res = await app.request('/products/p-1/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'p-slug-2' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: { id: string; slug: string } };
    expect(body.result.slug).toBe('p-slug-2');
    expect(body.result.id).not.toBe('p-1');
  });
});

// ============================================================================
// 3b. mapUniqueViolation — adapter-specific shapes → 409 envelope
// ============================================================================

describe('mapUniqueViolation: every adapter shape → ConflictException(409)', () => {
  it('SQLite / libSQL / D1: SQLITE_CONSTRAINT_UNIQUE → 409', () => {
    const out = mapUniqueViolation({
      code: 'SQLITE_CONSTRAINT_UNIQUE',
      message: 'UNIQUE constraint failed: products.slug',
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
    expect(out!.code).toBe('CONFLICT');
  });

  it('SQLite / libSQL / D1: bare "UNIQUE constraint failed" message → 409', () => {
    const out = mapUniqueViolation({
      message: 'SQLite error: UNIQUE constraint failed: products.slug',
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
  });

  it('PostgreSQL: code 23505 → 409', () => {
    const out = mapUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
  });

  it('MySQL / MariaDB: ER_DUP_ENTRY → 409', () => {
    const out = mapUniqueViolation({
      code: 'ER_DUP_ENTRY',
      message: "Duplicate entry 'x' for key 'slug'",
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
  });

  it('Prisma: P2002 → 409', () => {
    const out = mapUniqueViolation({
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      message: 'Unique constraint failed on the constraint: `products_slug_key`',
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(409);
  });

  it('non-unique errors → null (the global handler decides)', () => {
    expect(mapUniqueViolation(new Error('boom'))).toBeNull();
    expect(mapUniqueViolation(null)).toBeNull();
    expect(mapUniqueViolation(undefined)).toBeNull();
    expect(mapUniqueViolation({ code: '23502', message: 'not-null violation' })).toBeNull();
    expect(mapUniqueViolation('plain string')).toBeNull();
  });
});

// ============================================================================
// 4. Batch-create preserves `.default()` wrappers on the per-item schema
// ============================================================================

describe('batch-create: ZodDefault wrappers preserved on the per-item schema', () => {
  beforeEach(() => clearStorage());

  it('an item that omits a defaulted field gets the default — not a 400', async () => {
    const { app } = memoryProductsApp();
    const res = await app.request('/products/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ name: 'A', slug: 'a', priceCents: 100 }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      result: { created: Product[]; count: number };
    };
    expect(body.result.count).toBe(1);
    expect(body.result.created[0].currency).toBe('USD');
    expect(body.result.created[0].stock).toBe(0);
  });

  it('OpenAPI per-item schema shape marks defaulted fields as not-required', () => {
    const { ProductBatch, meta } = memoryProductsApp();
    const inst = new ProductBatch();
    (inst as any)._meta = meta;
    const schema = (inst as any).getBodySchema() as z.ZodTypeAny;
    const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as any;
    // Navigate body.items[].properties + required.
    const itemDef = js.properties?.items?.items as any;
    expect(itemDef).toBeTruthy();
    const required: string[] = itemDef.required ?? [];
    // Defaulted fields are NOT in `required` (Zod v4 marks ZodDefault input as optional).
    expect(required).not.toContain('currency');
    expect(required).not.toContain('stock');
    // Plain required fields stay required.
    expect(required).toContain('name');
    expect(required).toContain('slug');
    expect(required).toContain('priceCents');
    // The properties bag carries the defaulted fields (they're still accepted on input).
    expect(itemDef.properties).toHaveProperty('currency');
    expect(itemDef.properties).toHaveProperty('stock');
  });
});
