/**
 * Regression test for the serialization-profile leak fixed by the shared
 * `finalizeRecord` / `finalizeArray` pipeline.
 *
 * Before the fix, `restore`, `search`, and the batch endpoints serialized
 * records WITHOUT applying `model.serializationProfile`, leaking fields the
 * profile was meant to strip. `read`/`list` already applied it (controls).
 *
 * These tests assert the profiled field (`secret`) is stripped on every
 * record-returning path. `search`/`restore` exercise the same
 * `finalizeArray`/`finalizeRecord` methods the batch endpoints now use.
 */

import {
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemorySearchEndpoint,
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { Hono } from 'hono';
import { defineModel } from 'hono-crud';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  secret: z.string(),
  deletedAt: z.string().nullable().optional(),
});

const WidgetModel = defineModel({
  tableName: 'widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  // The whole point: `secret` must never reach a response.
  serializationProfile: { exclude: ['secret'] },
});

class WidgetList extends MemoryListEndpoint {
  _meta = { model: WidgetModel };
  schema = { tags: ['Widgets'] };
}
class WidgetRead extends MemoryReadEndpoint {
  _meta = { model: WidgetModel };
  schema = { tags: ['Widgets'] };
}
class WidgetSearch extends MemorySearchEndpoint {
  _meta = { model: WidgetModel };
  schema = { tags: ['Widgets'] };
  protected searchableFields = { name: { weight: 1 } };
}
class WidgetRestore extends MemoryRestoreEndpoint {
  _meta = { model: WidgetModel };
  schema = { tags: ['Widgets'] };
}

function makeApp(): Hono {
  const app = new Hono();
  app.onError((err, c) => c.json({ success: false, error: { message: err.message } }, 400));
  app.get('/widgets/search', (c) => {
    const e = new WidgetSearch();
    e.setContext(c);
    return e.handle();
  });
  app.get('/widgets/:id', (c) => {
    const e = new WidgetRead();
    e.setContext(c);
    return e.handle();
  });
  app.get('/widgets', (c) => {
    const e = new WidgetList();
    e.setContext(c);
    return e.handle();
  });
  app.post('/widgets/:id/restore', (c) => {
    const e = new WidgetRestore();
    e.setContext(c);
    return e.handle();
  });
  return app;
}

describe('serializationProfile is applied by the finalize pipeline', () => {
  let app: Hono;

  beforeEach(() => {
    clearStorage();
    const store = getStore<Record<string, unknown>>('widgets');
    store.set('w1', { id: 'w1', name: 'alpha gadget', secret: 'top-secret-1', deletedAt: null });
    store.set('w2', { id: 'w2', name: 'beta gadget', secret: 'top-secret-2', deletedAt: null });
    // A soft-deleted record for the restore path.
    store.set('w3', {
      id: 'w3',
      name: 'gamma gadget',
      secret: 'top-secret-3',
      deletedAt: '2020-01-01T00:00:00.000Z',
    });
    app = makeApp();
  });

  it('read (finalizeRecord, control) strips the profiled field', async () => {
    const res = await app.request('/widgets/w1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result.name).toBe('alpha gadget');
    expect(body.result.secret).toBeUndefined();
  });

  it('list (finalizeArray, control) strips the profiled field', async () => {
    const res = await app.request('/widgets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: Array<Record<string, unknown>> };
    expect(body.result.length).toBeGreaterThan(0);
    for (const row of body.result) {
      expect(row.secret).toBeUndefined();
    }
  });

  it('search (finalizeArray, regression) strips the profiled field', async () => {
    const res = await app.request('/widgets/search?q=gadget');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: Array<{ item: Record<string, unknown> }>;
    };
    expect(body.result.length).toBeGreaterThan(0);
    for (const row of body.result) {
      expect(row.item.name).toBeDefined();
      expect(row.item.secret).toBeUndefined();
    }
  });

  it('restore (finalizeRecord, regression) strips the profiled field', async () => {
    const res = await app.request('/widgets/w3/restore', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result.name).toBe('gamma gadget');
    expect(body.result.secret).toBeUndefined();
  });
});
