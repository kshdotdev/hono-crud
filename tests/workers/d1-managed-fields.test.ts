/**
 * D1 binds only `null | number | string | ArrayBuffer | boolean`, so the
 * engine-managed timestamps (createdAt / updatedAt / the soft-delete marker)
 * must be written in the representation each column declares. This test
 * runs the soft-delete lifecycle against two tables on a real D1 binding:
 * plain `integer()` epoch-ms columns and `integer({ mode: 'timestamp_ms' })`
 * columns (Drizzle expects a `Date` for the latter).
 */
import { env } from 'cloudflare:test';
import { type DrizzleDatabaseConstraint, createDrizzleCrud } from '@hono-crud/drizzle';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

type Bindings = { DB: D1Database };
type Env = { Bindings: Bindings };

// --- plain integer epoch-ms columns -----------------------------------------

const numTable = sqliteTable('mf_num', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
});

const NumSchema = z.object({
  id: z.string(),
  title: z.string(),
  deletedAt: z.number().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const numMeta = defineMeta({
  model: defineModel({
    tableName: 'mf_num',
    schema: NumSchema,
    primaryKeys: ['id'],
    table: numTable,
    softDelete: { field: 'deletedAt', allowQueryDeleted: true },
    timestamps: true,
  }),
});

// --- integer({ mode: 'timestamp_ms' }) columns (Drizzle binds a Date) --------

const tsTable = sqliteTable('mf_ts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

const TsSchema = z.object({
  id: z.string(),
  title: z.string(),
  deletedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

const tsMeta = defineMeta({
  model: defineModel({
    tableName: 'mf_ts',
    schema: TsSchema,
    primaryKeys: ['id'],
    table: tsTable,
    softDelete: { field: 'deletedAt', allowQueryDeleted: true },
    timestamps: true,
  }),
});

const placeholderDb = undefined as unknown as DrizzleDatabaseConstraint;
const Num = createDrizzleCrud<typeof numMeta, Env>(placeholderDb, numMeta, { dialect: 'sqlite' });
const Ts = createDrizzleCrud<typeof tsMeta, Env>(placeholderDb, tsMeta, { dialect: 'sqlite' });

function buildApp() {
  const base = new OpenAPIHono<Env>();
  base.use('*', async (c, next) => {
    c.set('db' as never, drizzle(c.env.DB) as never);
    await next();
  });
  const app = fromHono(base);
  registerCrud(app, '/num', {
    create: Num.Create,
    list: Num.List,
    read: Num.Read,
    update: Num.Update,
    delete: Num.Delete,
    restore: Num.Restore,
  });
  registerCrud(app, '/ts', {
    create: Ts.Create,
    list: Ts.List,
    read: Ts.Read,
    update: Ts.Update,
    delete: Ts.Delete,
    restore: Ts.Restore,
  });
  return app;
}

type Row = { id: string; deletedAt: unknown; createdAt: unknown; updatedAt: unknown };

async function lifecycle(base: '/num' | '/ts') {
  const app = buildApp();
  const request = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`https://example.com${path}`, init), { DB: env.DB });
  const json = async <T>(res: Response) => (await res.json()) as T;

  const created = await request(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'stamped' }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const row = (await json<{ result: Row }>(created)).result;
  expect(row.createdAt).toBeTruthy();
  expect(row.updatedAt).toBeTruthy();

  const updated = await request(`${base}/${row.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'stamped again' }),
  });
  expect(updated.status, await updated.clone().text()).toBe(200);

  const deleted = await request(`${base}/${row.id}`, { method: 'DELETE' });
  expect(deleted.status, await deleted.clone().text()).toBe(200);

  const hidden = await json<{ result: Row[] }>(await request(base));
  expect(hidden.result.map((r) => r.id)).not.toContain(row.id);

  const visible = await json<{ result: Row[] }>(await request(`${base}?withDeleted=true`));
  const softDeleted = visible.result.find((r) => r.id === row.id);
  expect(softDeleted).toBeDefined();
  expect(softDeleted?.deletedAt).toBeTruthy();

  const restored = await request(`${base}/${row.id}/restore`, { method: 'POST' });
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect((await json<{ result: Row }>(restored)).result.deletedAt).toBeNull();

  const back = await json<{ result: Row[] }>(await request(base));
  expect(back.result.map((r) => r.id)).toContain(row.id);

  return { row, softDeleted };
}

describe('managed timestamps on Cloudflare D1', () => {
  beforeEach(async () => {
    for (const table of ['mf_num', 'mf_ts']) {
      await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      await env.DB.prepare(`
        CREATE TABLE ${table} (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          deleted_at INTEGER,
          created_at INTEGER,
          updated_at INTEGER
        )
      `).run();
    }
  });

  it('writes epoch-ms numbers to plain integer columns', async () => {
    const { row, softDeleted } = await lifecycle('/num');
    expect(typeof row.createdAt).toBe('number');
    expect(typeof softDeleted?.deletedAt).toBe('number');

    const stored = await env.DB.prepare('SELECT deleted_at, created_at FROM mf_num WHERE id = ?')
      .bind(row.id)
      .first<{ deleted_at: number | null; created_at: number }>();
    expect(typeof stored?.created_at).toBe('number');
    expect(stored?.created_at).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
  });

  it('writes Date objects to timestamp_ms columns (stored as epoch ms)', async () => {
    const { row, softDeleted } = await lifecycle('/ts');
    // Dates serialise to ISO strings on the wire.
    expect(typeof row.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(String(row.createdAt)))).toBe(false);
    expect(Number.isNaN(Date.parse(String(softDeleted?.deletedAt)))).toBe(false);

    const stored = await env.DB.prepare('SELECT created_at FROM mf_ts WHERE id = ?')
      .bind(row.id)
      .first<{ created_at: number }>();
    expect(typeof stored?.created_at).toBe('number');
    expect(stored?.created_at).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
  });
});
