/**
 * Tests for engine-managed write-time fields:
 *   - `Model.id` primary-key generation strategy
 *     ('uuid' | 'database' | custom function)
 *   - `Model.timestamps` auto-managed createdAt / updatedAt
 *
 * Covers the centralized resolver applied uniformly by the adapters at
 * every write site (create / batchCreate / upsert / clone) and the update
 * sites (update / batchUpdate / upsert-update).
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import {
  fromHono,
  defineModel,
  defineMeta,
  applyManagedInsertFields,
  applyManagedUpdateFields,
  getTimestampsConfig,
} from 'hono-crud';
import type { IdStrategy } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryListEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryUpsertEndpoint,
  MemoryCloneEndpoint,
  clearStorage,
  getStorage,
} from '@hono-crud/memory';
import {
  DrizzleCreateEndpoint,
  DrizzleUpsertEndpoint,
  DrizzleCloneEndpoint,
  type DrizzleDatabase,
} from '@hono-crud/drizzle';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================================
// Schemas
// ============================================================================

const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
type Item = z.infer<typeof ItemSchema>;

// ============================================================================
// Helpers
// ============================================================================

let counter = 0;
const seqId = (): string => `seq-${++counter}`;

function memoryApp(modelOverrides: Partial<{
  id: IdStrategy;
  timestamps: boolean | { createdAt?: string; updatedAt?: string };
}>) {
  const model = defineModel({
    tableName: 'items',
    schema: ItemSchema,
    primaryKeys: ['id'],
    ...modelOverrides,
  });
  const meta = defineMeta({ model });

  class ItemCreate extends MemoryCreateEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemRead extends MemoryReadEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemUpdate extends MemoryUpdateEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemList extends MemoryListEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemBatchCreate extends MemoryBatchCreateEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemBatchUpdate extends MemoryBatchUpdateEndpoint<any, typeof meta> {
    _meta = meta;
  }
  class ItemUpsert extends MemoryUpsertEndpoint<any, typeof meta> {
    _meta = meta;
    upsertKeys = ['email'];
  }
  class ItemClone extends MemoryCloneEndpoint<any, typeof meta> {
    _meta = meta;
  }

  const app = fromHono(new Hono());
  app.onError((err, c) => c.json({ error: { message: err.message } }, 500));
  // Static routes before the `/:id` param routes to avoid shadowing.
  app.post('/items/batch', ItemBatchCreate as any);
  app.patch('/items/batch', ItemBatchUpdate as any);
  app.put('/items/upsert', ItemUpsert as any);
  app.post('/items', ItemCreate as any);
  app.get('/items', ItemList as any);
  app.post('/items/:id/clone', ItemClone as any);
  app.get('/items/:id', ItemRead as any);
  app.patch('/items/:id', ItemUpdate as any);
  return app;
}

// ============================================================================
// Model.id strategy
// ============================================================================

describe('Model.id strategy', () => {
  beforeEach(() => clearStorage());

  it('unset => crypto.randomUUID() (regression: unchanged default)', async () => {
    const app = memoryApp({});
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: Item };
    expect(body.result.id).toMatch(UUID_V4);
  });

  it("'uuid' => crypto.randomUUID() (explicit, unchanged default)", async () => {
    const app = memoryApp({ id: 'uuid' });
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const body = (await res.json()) as { result: Item };
    expect(body.result.id).toMatch(UUID_V4);
  });

  it('function generator => used as PK on create + batchCreate + upsert + clone', async () => {
    counter = 0;
    const app = memoryApp({ id: seqId });
    const store = getStorage<Item>('items');

    // create
    const c = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'one' }),
    });
    const created = ((await c.json()) as { result: Item }).result;
    expect(created.id).toBe('seq-1');

    // batchCreate
    const b = await app.request('/items/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'two' }, { name: 'three' }] }),
    });
    const batchBody = (await b.json()) as { result: { created: Item[] } };
    expect(batchBody.result.created.map((r) => r.id)).toEqual([
      'seq-2',
      'seq-3',
    ]);

    // upsert (create branch)
    const u = await app.request('/items/upsert', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'four', email: 'four@x.io' }),
    });
    const upserted = ((await u.json()) as { result: Item }).result;
    expect(upserted.id).toBe('seq-4');

    // clone
    const cl = await app.request(`/items/${created.id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const cloned = ((await cl.json()) as { result: Item }).result;
    expect(cloned.id).toBe('seq-5');
    expect(cloned.id).not.toBe(created.id);

    expect(store.size).toBe(5);
  });

  it('caller-supplied PK wins over every strategy (resolver precedence)', () => {
    // The HTTP body schema strips the PK by framework design, so the
    // precedence is the centralized resolver's contract — assert it there.
    const fnModel = { id: seqId, primaryKeys: ['id'] as string[] };
    expect(
      applyManagedInsertFields({ id: 'mine', name: 'a' }, fnModel, 'memory').id
    ).toBe('mine');

    const uuidModel = { id: 'uuid' as const, primaryKeys: ['id'] as string[] };
    expect(
      applyManagedInsertFields({ id: 'mine', name: 'a' }, uuidModel, 'drizzle')
        .id
    ).toBe('mine');

    const dbModel = { id: 'database' as const, primaryKeys: ['id'] as string[] };
    const out = applyManagedInsertFields(
      { id: 'mine', name: 'a' },
      dbModel,
      'drizzle'
    );
    expect(out.id).toBe('mine'); // not deleted: caller supplied it

    // Empty-string / null PK is treated as "not supplied".
    expect(
      typeof applyManagedInsertFields({ id: '', name: 'a' }, uuidModel, 'memory')
        .id
    ).toBe('string');
    expect(
      applyManagedInsertFields({ id: '', name: 'a' }, uuidModel, 'memory').id
    ).not.toBe('');
  });

  it('resolver: function/database strategy precedence + memory guard', () => {
    const dbModel = { id: 'database' as const, primaryKeys: ['id'] as string[] };
    // database strategy on a feasible adapter omits the PK entirely.
    expect(
      'id' in
        applyManagedInsertFields({ name: 'a' }, dbModel, 'prisma')
    ).toBe(false);
    // memory adapter + database => throws the documented error.
    expect(() =>
      applyManagedInsertFields({ name: 'a' }, dbModel, 'memory')
    ).toThrow(
      "MemoryAdapter does not support id:'database' (no database to generate the key)"
    );
  });

  it("'database' + memory adapter => throws the documented ConfigurationException", async () => {
    const app = memoryApp({ id: 'database' });
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "MemoryAdapter does not support id:'database' (no database to generate the key)"
    );
  });
});

// ============================================================================
// Model.id 'database' strategy — Drizzle ($defaultFn fills the PK)
// ============================================================================

describe("Model.id 'database' strategy (Drizzle $defaultFn)", () => {
  const dbItems = sqliteTable('db_items', {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `DBGEN-${Math.random().toString(36).slice(2, 10)}`),
    name: text('name').notNull(),
    email: text('email'),
  });

  const DbSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable().optional(),
  });

  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);

  const model = defineModel({
    tableName: 'db_items',
    schema: DbSchema,
    primaryKeys: ['id'],
    table: dbItems,
    id: 'database',
  });
  const meta = defineMeta({ model });

  class DbCreate extends DrizzleCreateEndpoint<any, typeof meta> {
    _meta = meta;
    db = db as unknown as DrizzleDatabase;
  }
  class DbUpsert extends DrizzleUpsertEndpoint<any, typeof meta> {
    _meta = meta;
    db = db as unknown as DrizzleDatabase;
    upsertKeys = ['email'];
  }
  class DbClone extends DrizzleCloneEndpoint<any, typeof meta> {
    _meta = meta;
    db = db as unknown as DrizzleDatabase;
  }

  let app: Hono;

  beforeAll(async () => {
    await db.run(
      sql`CREATE TABLE IF NOT EXISTS db_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT)`
    );
  });

  beforeEach(async () => {
    await db.delete(dbItems);
    app = new Hono();
    app.onError((err, c) => c.json({ error: { message: err.message } }, 400));
    const withCtx =
      <T extends { setContext: (c: unknown) => void; handle: () => Promise<Response> }>(
        E: new () => T
      ) =>
      async (c: unknown) => {
        const e = new E();
        e.setContext(c);
        return e.handle();
      };
    app.post('/db', withCtx(DbCreate));
    app.put('/db/upsert', withCtx(DbUpsert));
    app.post('/db/:id/clone', withCtx(DbClone));
  });

  it('omits the PK from INSERT; DB $defaultFn value is returned (create)', async () => {
    const res = await app.request('/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: { id: string; name: string } };
    expect(body.result.name).toBe('alpha');
    expect(body.result.id).toMatch(/^DBGEN-/);
  });

  it('database strategy applies through upsert (create branch) and clone', async () => {
    const u = await app.request('/db/upsert', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'beta', email: 'beta@x.io' }),
    });
    const upserted = ((await u.json()) as { result: { id: string } }).result;
    expect(upserted.id).toMatch(/^DBGEN-/);

    const cl = await app.request(`/db/${upserted.id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const cloned = ((await cl.json()) as { result: { id: string } }).result;
    expect(cloned.id).toMatch(/^DBGEN-/);
    expect(cloned.id).not.toBe(upserted.id);
  });

  it('resolver omits PK for database strategy so RETURNING surfaces the $defaultFn value', () => {
    const dbModel = { id: 'database' as const, primaryKeys: ['id'] as string[] };
    const payload = applyManagedInsertFields(
      { name: 'gamma' },
      dbModel,
      'drizzle'
    );
    // PK omitted from the insert payload => Drizzle $defaultFn fills it,
    // then `.returning()` reflects the generated value (verified e2e above).
    expect('id' in payload).toBe(false);
    expect(payload.name).toBe('gamma');
  });
});

// ============================================================================
// Model.timestamps
// ============================================================================

describe('Model.timestamps', () => {
  beforeEach(() => clearStorage());

  it('unset => no stamping (regression)', async () => {
    const app = memoryApp({});
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const body = (await res.json()) as { result: Item };
    expect(body.result.createdAt).toBeUndefined();
    expect(body.result.updatedAt).toBeUndefined();
  });

  it('true => create sets createdAt & updatedAt (epoch ms)', async () => {
    const before = Date.now();
    const app = memoryApp({ timestamps: true });
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const body = (await res.json()) as { result: Item };
    expect(typeof body.result.createdAt).toBe('number');
    expect(typeof body.result.updatedAt).toBe('number');
    expect(body.result.createdAt!).toBeGreaterThanOrEqual(before);
    expect(body.result.createdAt).toBe(body.result.updatedAt);
  });

  it('true => update bumps updatedAt, leaves createdAt untouched', async () => {
    const app = memoryApp({ timestamps: true });
    const c = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const created = ((await c.json()) as { result: Item }).result;

    await new Promise((r) => setTimeout(r, 5));

    const u = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'b' }),
    });
    const updated = ((await u.json()) as { result: Item }).result;
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt!).toBeGreaterThan(created.updatedAt!);
  });

  it('batchUpdate and upsert-update also bump updatedAt', async () => {
    const app = memoryApp({ timestamps: true });
    const c = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a', email: 'a@x.io' }),
    });
    const created = ((await c.json()) as { result: Item }).result;

    await new Promise((r) => setTimeout(r, 5));

    // batchUpdate
    const b = await app.request('/items/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: created.id, data: { name: 'b' } }] }),
    });
    const batchUpdated = ((await b.json()) as { result: { updated: Item[] } })
      .result.updated[0];
    expect(batchUpdated.createdAt).toBe(created.createdAt);
    expect(batchUpdated.updatedAt!).toBeGreaterThan(created.updatedAt!);

    await new Promise((r) => setTimeout(r, 5));

    // upsert-update (existing record matched by email)
    const u = await app.request('/items/upsert', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'c', email: 'a@x.io' }),
    });
    const upsertUpdated = ((await u.json()) as { result: Item }).result;
    expect(upsertUpdated.id).toBe(created.id);
    expect(upsertUpdated.updatedAt!).toBeGreaterThan(batchUpdated.updatedAt!);
  });

  it('object form renames the timestamp fields', async () => {
    const app = memoryApp({
      timestamps: { createdAt: 'created_ms', updatedAt: 'updated_ms' },
    });
    const store = getStorage<Record<string, unknown>>('items');
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(typeof body.result.created_ms).toBe('number');
    expect(typeof body.result.updated_ms).toBe('number');
    expect(body.result.createdAt).toBeUndefined();
    expect(body.result.updatedAt).toBeUndefined();

    const stored = [...store.values()][0];
    expect(typeof stored.created_ms).toBe('number');
  });

  it('client-supplied updatedAt on update is overridden by the server value', async () => {
    const app = memoryApp({ timestamps: true });
    const c = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    const created = ((await c.json()) as { result: Item }).result;

    const u = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'b', updatedAt: 1 }),
    });
    const updated = ((await u.json()) as { result: Item }).result;
    expect(updated.updatedAt).not.toBe(1);
    expect(updated.updatedAt!).toBeGreaterThanOrEqual(created.createdAt!);
  });

  it('resolver: applyManagedUpdateFields always bumps updatedAt, never createdAt, ignores client value', () => {
    // disabled => payload unchanged (new object, no stamping)
    const off = applyManagedUpdateFields({ name: 'a' }, { timestamps: undefined });
    expect('updatedAt' in off).toBe(false);

    // enabled => updatedAt forced to a server value, client value ignored,
    // createdAt never touched.
    const on = applyManagedUpdateFields(
      { name: 'a', updatedAt: 1, createdAt: 999 },
      { timestamps: true }
    );
    expect(on.updatedAt).not.toBe(1);
    expect(typeof on.updatedAt).toBe('number');
    expect(on.createdAt).toBe(999); // untouched

    // object form resolves the renamed updated field.
    const renamed = applyManagedUpdateFields(
      { name: 'a' },
      { timestamps: { updatedAt: 'updated_ms' } }
    );
    expect(typeof (renamed as Record<string, unknown>).updated_ms).toBe(
      'number'
    );

    // getTimestampsConfig normalization
    expect(getTimestampsConfig(undefined).enabled).toBe(false);
    expect(getTimestampsConfig(true)).toEqual({
      enabled: true,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    });
    expect(getTimestampsConfig({ createdAt: 'c' })).toEqual({
      enabled: true,
      createdAt: 'c',
      updatedAt: 'updatedAt',
    });
  });

  it('createdAt is engine-managed: stripped from the model-derived create input, server-stamped', async () => {
    // As of 0.12.1 the configured timestamp fields are excluded from the
    // model-derived create input schema (the engine owns them at the
    // write site). A client-supplied `createdAt` over the HTTP body is
    // therefore dropped at validation and the server value is used.
    const before = Date.now();
    const app = memoryApp({ timestamps: true });
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a', createdAt: 12345 }),
    });
    const body = (await res.json()) as { result: Item };
    expect(body.result.createdAt).not.toBe(12345);
    expect(typeof body.result.createdAt).toBe('number');
    expect(body.result.createdAt!).toBeGreaterThanOrEqual(before);
    expect(typeof body.result.updatedAt).toBe('number');
  });

  it('resolver still respects a caller-supplied createdAt when present (only fills when absent)', () => {
    // The write-site resolver contract is unchanged: when `createdAt` is
    // already on the record it is preserved; only an absent field is
    // filled. (Reaching it with a value now requires a consumer body
    // schema or a `before` hook, since the model-derived input strips it.)
    const model = { id: 'uuid' as const, primaryKeys: ['id'] as string[], timestamps: true };
    const kept = applyManagedInsertFields(
      { id: 'x', name: 'a', createdAt: 12345 },
      model,
      'memory'
    );
    expect(kept.createdAt).toBe(12345);
    expect(typeof kept.updatedAt).toBe('number');

    const filled = applyManagedInsertFields({ id: 'x', name: 'a' }, model, 'memory');
    expect(typeof filled.createdAt).toBe('number');
    expect(filled.createdAt).toBe(filled.updatedAt);
  });
});
