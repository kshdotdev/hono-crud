/**
 * Query-string filter values are coerced by the model's zod kind before they
 * reach the adapter. The typed Drizzle column modes are the motivating case:
 * `integer({ mode: 'boolean' })` maps `v ? 1 : 0`, so the raw string "false"
 * used to select the `true` rows, and `integer({ mode: 'timestamp' })` calls
 * `.getTime()` on the bound value, so a raw string threw a TypeError.
 */
import { type DrizzleDatabaseConstraint, createDrizzleCrud } from '@hono-crud/drizzle';
import { clearStorage, createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

type ListBody = { success: boolean; result: Array<{ id: string; title: string }> };
type ErrorBody = { success: false; error: { code: string; message: string } };

async function titles(res: Response): Promise<string[]> {
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as ListBody;
  return body.result.map((r) => r.title).sort();
}

// ============================================================================
// Memory adapter
// ============================================================================

const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  active: z.boolean(),
  score: z.number().int().nullable().optional(),
});

const itemMeta = defineMeta({
  model: defineModel({ tableName: 'coercion_items', schema: ItemSchema, primaryKeys: ['id'] }),
});
const Items = createMemoryCrud(itemMeta);

class ItemList extends Items.List {
  filterFields = ['active'];
  filterConfig = { score: ['gte', 'lte', 'in'] as const };
}

describe('filter coercion (memory adapter)', () => {
  const app = fromHono(new OpenAPIHono());
  registerCrud(app, '/items', { create: Items.Create, list: ItemList });

  beforeEach(async () => {
    clearStorage();
    for (const item of [
      { title: 'on-high', active: true, score: 90 },
      { title: 'on-low', active: true, score: 10 },
      { title: 'off', active: false, score: 50 },
    ]) {
      const res = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      expect(res.status).toBe(201);
    }
  });

  it('coerces a boolean field so ?active=false matches only inactive rows', async () => {
    expect(await titles(await app.request('/items?active=false'))).toEqual(['off']);
    expect(await titles(await app.request('/items?active=true'))).toEqual(['on-high', 'on-low']);
    expect(await titles(await app.request('/items?active=0'))).toEqual(['off']);
  });

  it('coerces numeric operators, including array operators elementwise', async () => {
    expect(await titles(await app.request('/items?score[gte]=50'))).toEqual(['off', 'on-high']);
    expect(await titles(await app.request('/items?score[in]=10,90'))).toEqual([
      'on-high',
      'on-low',
    ]);
  });

  it('rejects values that cannot be coerced with 400 VALIDATION_ERROR', async () => {
    for (const query of ['active=maybe', 'score[gte]=abc', 'score[in]=1,x']) {
      const res = await app.request(`/items?${query}`);
      expect(res.status, query).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/expects a (boolean|number)/);
    }
  });
});

// ============================================================================
// Drizzle adapter over libsql with typed column modes
// ============================================================================

const todos = sqliteTable('coercion_todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull(),
  due: integer('due', { mode: 'timestamp' }),
  priority: integer('priority').notNull(),
});

const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  due: z.coerce.date().nullable().optional(),
  priority: z.number().int(),
});

const client = createClient({ url: ':memory:' });
const db = drizzle(client);

const todoMeta = defineMeta({
  model: defineModel({
    tableName: 'coercion_todos',
    schema: TodoSchema,
    primaryKeys: ['id'],
    table: todos,
  }),
});
const Todos = createDrizzleCrud(db as unknown as DrizzleDatabaseConstraint, todoMeta, {
  dialect: 'sqlite',
});

class TodoList extends Todos.List {
  filterFields = ['done'];
  filterConfig = { due: ['gte', 'lt'] as const, priority: ['gte'] as const };
}

describe('filter coercion (drizzle + typed sqlite column modes)', () => {
  const app = fromHono(new OpenAPIHono());
  registerCrud(app, '/todos', { list: TodoList });

  beforeAll(async () => {
    await client.execute(`
      CREATE TABLE coercion_todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL,
        due INTEGER,
        priority INTEGER NOT NULL
      )
    `);
    await db.insert(todos).values([
      { id: 't1', title: 'ship', done: true, due: new Date('2026-05-01T00:00:00Z'), priority: 3 },
      { id: 't2', title: 'write', done: false, due: new Date('2026-07-01T00:00:00Z'), priority: 1 },
      { id: 't3', title: 'rest', done: false, due: null, priority: 2 },
    ]);
  });

  it('?done=false selects the false rows on a boolean-mode column', async () => {
    expect(await titles(await app.request('/todos?done=false'))).toEqual(['rest', 'write']);
    expect(await titles(await app.request('/todos?done=true'))).toEqual(['ship']);
  });

  it('date filters on a timestamp-mode column bind a Date instead of throwing', async () => {
    expect(await titles(await app.request('/todos?due[gte]=2026-06-01'))).toEqual(['write']);
    expect(await titles(await app.request('/todos?due[lt]=2026-06-01'))).toEqual(['ship']);
  });

  it('numeric filters still work on plain integer columns', async () => {
    expect(await titles(await app.request('/todos?priority[gte]=2'))).toEqual(['rest', 'ship']);
  });

  it('rejects an unparseable date with 400', async () => {
    const res = await app.request('/todos?due[gte]=not-a-date');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.message).toMatch(/expects a date/);
  });
});
