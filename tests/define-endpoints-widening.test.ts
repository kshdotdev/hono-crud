import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  fromHono,
  registerCrud,
  defineEndpoints,
  MemoryAdapters,
  defineMeta,
  defineModel,
} from '../src/index.js';
import { clearStorage } from '../src/adapters/memory/index.js';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().optional(),
  deletedAt: z.string().nullable().optional(),
});

const WidgetModel = defineModel({
  tableName: 'widgets_widening',
  schema: WidgetSchema,
  primaryKeys: ['id'],
  softDelete: true,
});

const widgetMeta = defineMeta({ model: WidgetModel });

const ALL_VERBS = [
  'create',
  'list',
  'read',
  'update',
  'delete',
  'search',
  'aggregate',
  'restore',
  'batchCreate',
  'batchUpdate',
  'batchDelete',
  'batchRestore',
  'batchUpsert',
  'export',
  'import',
  'upsert',
  'clone',
] as const;

describe('defineEndpoints widening to 17 verbs', () => {
  beforeEach(() => clearStorage());

  it('generates an endpoint class for every configured verb', () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        create: {},
        list: {},
        read: {},
        update: {},
        delete: {},
        search: { fields: ['name'] },
        aggregate: { fields: ['id'] },
        restore: {},
        batchCreate: { maxBatchSize: 50 },
        batchUpdate: { maxBatchSize: 50 },
        batchDelete: { maxBatchSize: 50 },
        batchRestore: { maxBatchSize: 50 },
        batchUpsert: { maxBatchSize: 50, conflictTarget: 'id' },
        export: { formats: ['json'], maxRows: 1000 },
        import: { maxRows: 1000 },
        upsert: { conflictTarget: 'id' },
        clone: { fieldsToReset: ['status'] },
      },
      MemoryAdapters,
    );

    for (const verb of ALL_VERBS) {
      expect(typeof endpoints[verb]).toBe('function');
    }
  });

  it('skips slots not present in the config', () => {
    const endpoints = defineEndpoints(
      { meta: widgetMeta, create: {}, list: {} },
      MemoryAdapters,
    );

    expect(typeof endpoints.create).toBe('function');
    expect(typeof endpoints.list).toBe('function');
    expect(endpoints.search).toBeUndefined();
    expect(endpoints.aggregate).toBeUndefined();
    expect(endpoints.restore).toBeUndefined();
    expect(endpoints.batchCreate).toBeUndefined();
    expect(endpoints.batchUpsert).toBeUndefined();
    expect(endpoints.upsert).toBeUndefined();
    expect(endpoints.clone).toBeUndefined();
  });

  it('forwards verb-specific config keys onto the generated class instance', () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        clone: { fieldsToReset: ['status', 'deletedAt'] },
        upsert: { conflictTarget: 'id' },
        batchUpsert: { conflictTarget: ['id', 'name'], maxBatchSize: 25 },
        batchCreate: { maxBatchSize: 7 },
        export: { formats: ['csv', 'json'], maxRows: 500 },
        import: { maxRows: 999 },
        search: { fields: ['name'], mode: 'all' },
        aggregate: { fields: ['status'] },
      },
      MemoryAdapters,
    );

    type Probe = Record<string, unknown>;
    const cloneInst = new endpoints.clone!() as unknown as Probe;
    expect(cloneInst.excludeFromClone).toEqual(['status', 'deletedAt']);

    const upsertInst = new endpoints.upsert!() as unknown as Probe;
    expect(upsertInst.upsertKeys).toEqual(['id']);

    const batchUpsertInst = new endpoints.batchUpsert!() as unknown as Probe;
    expect(batchUpsertInst.upsertKeys).toEqual(['id', 'name']);
    expect(batchUpsertInst.maxBatchSize).toBe(25);

    const batchCreateInst = new endpoints.batchCreate!() as unknown as Probe;
    expect(batchCreateInst.maxBatchSize).toBe(7);

    const exportInst = new endpoints.export!() as unknown as Probe;
    expect(exportInst.maxExportRecords).toBe(500);
    expect(exportInst.defaultFormat).toBe('csv');

    const importInst = new endpoints.import!() as unknown as Probe;
    expect(importInst.maxBatchSize).toBe(999);

    const searchInst = new endpoints.search!() as unknown as Probe;
    expect(searchInst.searchFields).toEqual(['name']);
    expect(searchInst.defaultMode).toBe('all');

    const aggregateInst = new endpoints.aggregate!() as unknown as Probe;
    expect(aggregateInst.filterFields).toEqual(['status']);
  });

  it('mounts every verb under registerCrud and the routes do not 5xx', async () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        create: {},
        list: {},
        read: {},
        update: {},
        delete: {},
        search: { fields: ['name'] },
        aggregate: { fields: ['id'] },
        restore: {},
        batchCreate: {},
        batchUpdate: {},
        batchDelete: {},
        batchRestore: {},
        batchUpsert: { conflictTarget: 'id' },
        export: {},
        import: {},
        upsert: { conflictTarget: 'id' },
        clone: {},
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints);

    // Seed one record so item-level routes have something to operate on.
    const created = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'first' }),
    });
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { result: { id: string } };
    const seedId = createdJson.result.id;

    type Probe = { method: string; path: string; body?: unknown };
    const probes: Probe[] = [
      { method: 'GET', path: '/widgets' },
      { method: 'GET', path: '/widgets/search?q=first' },
      { method: 'GET', path: '/widgets/aggregate?aggregations=count' },
      { method: 'GET', path: '/widgets/export' },
      { method: 'POST', path: '/widgets/batch', body: { items: [{ name: 'b' }] } },
      { method: 'PATCH', path: '/widgets/batch', body: { items: [] } },
      { method: 'DELETE', path: '/widgets/batch', body: { ids: [] } },
      { method: 'POST', path: '/widgets/batch/restore', body: { ids: [] } },
      { method: 'POST', path: '/widgets/batch/upsert', body: { items: [{ id: seedId, name: 'updated' }] } },
      { method: 'POST', path: '/widgets/import', body: { items: [] } },
      { method: 'POST', path: '/widgets/upsert', body: { id: seedId, name: 'upserted' } },
      { method: 'GET', path: `/widgets/${seedId}` },
      { method: 'PATCH', path: `/widgets/${seedId}`, body: { name: 'renamed' } },
      { method: 'POST', path: `/widgets/${seedId}/clone`, body: {} },
      { method: 'DELETE', path: `/widgets/${seedId}` },
      { method: 'POST', path: `/widgets/${seedId}/restore` },
    ];

    for (const probe of probes) {
      const init: RequestInit = { method: probe.method };
      if (probe.body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(probe.body);
      }
      const res = await app.request(probe.path, init);
      expect(
        res.status,
        `${probe.method} ${probe.path} returned ${res.status}`,
      ).toBeLessThan(500);
    }
  });

  it('routes /upsert as upsert, not as read({ id: "upsert" })', async () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        read: {},
        upsert: { conflictTarget: 'id' },
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints);

    // GET /widgets/upsert → read handler (id="upsert"), 404 because no record.
    const readRes = await app.request('/widgets/upsert');
    expect(readRes.status).toBe(404);

    // POST /widgets/upsert → upsert handler, must not 404 with read's id-not-found shape.
    const upsertRes = await app.request('/widgets/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fixed-id', name: 'via upsert' }),
    });
    expect(upsertRes.status).toBeLessThan(500);
    expect(upsertRes.status).not.toBe(404);
  });

  it('routes /batch/upsert distinct from /batch/{create,update,delete,restore}', async () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        batchCreate: {},
        batchUpsert: { conflictTarget: 'id' },
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints);

    const upsertRes = await app.request('/widgets/batch/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 'x', name: 'x' }] }),
    });
    expect(upsertRes.status).toBeLessThan(500);
  });
});
