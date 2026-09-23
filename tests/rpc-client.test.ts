import { clearStorage, createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  OpenAPIRoute,
  type OpenAPIRouteSchema,
  defineMeta,
  defineModel,
  fromHono,
  registerCrud,
  registerCrudResources,
} from 'hono-crud';
import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number(),
});

const WidgetModel = defineModel({
  tableName: 'rpc_widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});

const widgetMeta = defineMeta({
  model: WidgetModel,
  fields: z.object({ name: z.string(), qty: z.number() }),
});

const Widgets = createMemoryCrud(widgetMeta);

class WidgetStats extends OpenAPIRoute {
  schema = {
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ month: z.string().optional() }),
    },
    responses: {
      200: {
        description: 'Stats',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              result: z.object({ id: z.string(), month: z.string().nullable() }),
            }),
          },
        },
      },
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    const { params, query } = await this.getValidatedData<never>();
    const id = (params as { id: string }).id;
    const month = (query as { month?: string } | undefined)?.month ?? null;
    return this.success({ id, month });
  }
}

function buildApp() {
  const base = fromHono(new OpenAPIHono()).get('/widgets/:id/stats', WidgetStats);
  return registerCrud(base, '/widgets', {
    list: Widgets.List,
    create: Widgets.Create,
    read: Widgets.Read,
    update: Widgets.Update,
    delete: Widgets.Delete,
  });
}

describe('typed RPC client (hc) over hono-crud apps', () => {
  beforeEach(() => {
    clearStorage();
  });

  it('drives CRUD verbs end to end with status narrowing', async () => {
    const app = buildApp();
    const client = hc<typeof app>('http://localhost', { fetch: app.request });

    const created = await client.widgets.$post({ json: { name: 'gear', qty: 3 } });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    if (!createdBody.success) throw new Error('expected success');
    expect(createdBody.result.name).toBe('gear');

    const listed = await client.widgets.$get();
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    if (!listBody.success) throw new Error('expected success');
    expect(listBody.result).toHaveLength(1);
    expect(listBody.result_info.page).toBe(1);

    const read = await client.widgets[':id'].$get({ param: { id: createdBody.result.id } });
    expect(read.status).toBe(200);

    const updated = await client.widgets[':id'].$patch({
      param: { id: createdBody.result.id },
      json: { qty: 5 },
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    if (!updatedBody.success) throw new Error('expected success');
    expect(updatedBody.result.qty).toBe(5);

    const missing = await client.widgets[':id'].$get({ param: { id: 'nope' } });
    expect(missing.status).toBe(404);
    const missingBody = await missing.json();
    expect(missingBody.success).toBe(false);

    const removed = await client.widgets[':id'].$delete({ param: { id: createdBody.result.id } });
    expect(removed.status).toBe(200);
    const removedBody = await removed.json();
    if (!removedBody.success) throw new Error('expected success');
    expect(removedBody.result.deleted).toBe(true);
  });

  it('builds URLs for class routes and passes params + query through', async () => {
    const app = buildApp();
    const client = hc<typeof app>('http://localhost', { fetch: app.request });

    const url = client.widgets[':id'].stats.$url({ param: { id: 'w1' } });
    expect(url.pathname).toBe('/widgets/w1/stats');

    const res = await client.widgets[':id'].stats.$get({
      param: { id: 'w1' },
      query: { month: '2026-01' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    if (!body.success) throw new Error('expected success');
    expect(body.result).toEqual({ id: 'w1', month: '2026-01' });
  });

  it('registerCrudResources mounts every resource', async () => {
    const app = registerCrudResources(fromHono(new OpenAPIHono()), {
      '/a': { list: Widgets.List },
      '/b': { create: Widgets.Create, list: Widgets.List },
    });
    const client = hc<typeof app>('http://localhost', { fetch: app.request });

    const created = await client.b.$post({ json: { name: 'x', qty: 1 } });
    expect(created.status).toBe(201);

    // Both resources share the memory table, so the row shows up under /a too.
    const listedA = await client.a.$get();
    expect(listedA.status).toBe(200);
    const bodyA = await listedA.json();
    if (!bodyA.success) throw new Error('expected success');
    expect(bodyA.result).toHaveLength(1);

    expect(client.a.$url().pathname).toBe('/a');
    expect(client.b.$url().pathname).toBe('/b');
  });
});
