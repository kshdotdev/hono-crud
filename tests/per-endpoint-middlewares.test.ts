/**
 * Tests for the per-endpoint `middlewares?: MiddlewareHandler[]` slot on
 * every `EndpointsConfig<M>` config block. The slot lets consumers attach
 * route-level middleware (e.g., `requireApproval`, `requirePolicy`) directly
 * via `defineEndpoints(...)` without falling back to `app.use(path, ...)`
 * with HTTP-method gating.
 *
 * Internally, `defineEndpoints` forwards `cfg.middlewares` into
 * `generateEndpointClass(...)`, which assigns them to `static _middlewares`
 * on the generated class. `registerCrud` already merges class-level
 * `_middlewares` with the explicit `RegisterCrudOptions.endpointMiddlewares`,
 * so this is purely additive — no other surface changes.
 */

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
  requireApproval,
  MemoryApprovalStorage,
} from '../src/index.js';
import { clearStorage } from '../src/adapters/memory/index.js';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const WidgetModel = defineModel({
  tableName: 'widgets_per_endpoint_mw',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});

const widgetMeta = defineMeta({ model: WidgetModel });

describe('EndpointsConfig per-endpoint middlewares slot', () => {
  let approvalStorage: MemoryApprovalStorage;

  beforeEach(() => {
    clearStorage();
    approvalStorage = new MemoryApprovalStorage();
  });

  it('applies endpoints.delete.middlewares to the DELETE route only', async () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        create: {},
        delete: {
          middlewares: [
            requireApproval({
              reason: 'destructive widget delete',
              approvalStorage,
            }),
          ],
        },
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints);

    // CREATE has no gate — succeeds outright.
    const createRes = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'first' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { result: { id: string } };
    const widgetId = created.result.id;

    // First DELETE → 202, gated by requireApproval, returns actionId.
    const firstDelete = await app.request(`/widgets/${widgetId}`, {
      method: 'DELETE',
    });
    expect(firstDelete.status).toBe(202);
    const pending = (await firstDelete.json()) as {
      status: string;
      actionId: string;
    };
    expect(pending.status).toBe('pending');
    expect(pending.actionId).toMatch(/^[0-9a-f-]{36}$/);

    // Approver signs off, then resume the DELETE.
    await approvalStorage.approve(pending.actionId, 'approver-1');
    const resumed = await app.request(`/widgets/${widgetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _resume_: pending.actionId }),
    });
    // The DeleteEndpoint runs to completion (200/204 either is acceptable;
    // `requireApproval` doesn't constrain the downstream status).
    expect([200, 204]).toContain(resumed.status);
  });

  it('does NOT apply endpoints.create.middlewares to the DELETE route', async () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        create: {
          middlewares: [
            requireApproval({
              reason: 'gated create',
              approvalStorage,
            }),
          ],
        },
        delete: {},
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints);

    // CREATE is gated → 202.
    const createRes = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gated' }),
    });
    expect(createRes.status).toBe(202);
    const pending = (await createRes.json()) as { actionId: string };
    await approvalStorage.approve(pending.actionId, 'approver-1');

    // Resume CREATE so we have a row to delete.
    const resumed = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'gated',
        _resume_: pending.actionId,
      }),
    });
    expect(resumed.status).toBe(201);
    const created = (await resumed.json()) as { result: { id: string } };

    // DELETE has NO middleware attached — must execute outright (no 202).
    const deleteRes = await app.request(`/widgets/${created.result.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).not.toBe(202);
    expect([200, 204]).toContain(deleteRes.status);
  });

  it('explicit endpointMiddlewares on registerCrud overrides the config-API slot', async () => {
    // Sanity check: ensure the existing RegisterCrudOptions.endpointMiddlewares
    // path still works alongside config-API middlewares. registerCrud merges
    // [global, endpointMiddlewares, classMiddlewares] in order — so an
    // explicit override is composed with (not silently dropped by) the
    // config-API slot.
    let configMwHits = 0;
    let optionMwHits = 0;

    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        create: {
          middlewares: [
            async (_c, next) => {
              configMwHits += 1;
              await next();
            },
          ],
        },
      },
      MemoryAdapters,
    );

    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', endpoints, {
      endpointMiddlewares: {
        create: [
          async (_c, next) => {
            optionMwHits += 1;
            await next();
          },
        ],
      },
    });

    const res = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'both' }),
    });
    expect(res.status).toBe(201);
    expect(configMwHits).toBe(1);
    expect(optionMwHits).toBe(1);
  });
});
