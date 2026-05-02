/**
 * Tests for `CrudEventPayload.tenantId` / `.organizationId` (0.7.0).
 *
 * Subscribers need both fields surfaced on every emit so they can fan out
 * per-tenant/per-org without re-deriving identity from the record body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';

import {
  fromHono,
  defineModel,
  defineMeta,
  multiTenant,
  setEventEmitter,
  CrudEventEmitter,
  setContextVar,
  type CrudEventPayload,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';

const TENANT = 'tenant-payload-test';
const ORG = 'org-payload-test';

const ItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.uuid(),
  title: z.string(),
});

const Model = defineModel({
  tableName: 'items_evt',
  schema: ItemSchema,
  primaryKeys: ['id'],
  multiTenant: true,
});
const meta = defineMeta({ model: Model });

class ItemCreate extends MemoryCreateEndpoint {
  _meta = meta;
}

describe('CrudEventPayload tenantId/organizationId', () => {
  beforeEach(() => {
    clearStorage();
  });

  it('populates tenantId from multiTenant() middleware', async () => {
    const received: CrudEventPayload[] = [];
    const emitter = new CrudEventEmitter();
    emitter.onTable('items_evt', (e) => received.push(e));
    setEventEmitter(emitter);

    const honoApp = new OpenAPIHono();
    honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
    const app = fromHono(honoApp);
    app.post('/items', ItemCreate);

    const res = await app.request('/items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': TENANT,
      },
      body: JSON.stringify({ title: 'evt-check' }),
    });
    expect(res.status).toBe(201);
    // emitEvent runs after the response — give the event loop a tick.
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0].tenantId).toBe(TENANT);
  });

  it('populates organizationId from c.var.organizationId', async () => {
    const received: CrudEventPayload[] = [];
    const emitter = new CrudEventEmitter();
    emitter.onTable('items_evt', (e) => received.push(e));
    setEventEmitter(emitter);

    const honoApp = new OpenAPIHono();
    // Multi-tenant for tenantId, plus a custom middleware for organizationId.
    honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
    honoApp.use('/*', async (c, next) => {
      setContextVar(c, 'organizationId', ORG);
      await next();
    });
    const app = fromHono(honoApp);
    app.post('/items', ItemCreate);

    const res = await app.request('/items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': TENANT,
      },
      body: JSON.stringify({ title: 'org-check' }),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    expect(received[0].tenantId).toBe(TENANT);
    expect(received[0].organizationId).toBe(ORG);
  });
});
