/**
 * Per-tenant schema resolution running inside miniflare.
 *
 * Confirms that `Model.resolveSchema` and `buildPerTenantOpenApi` work in
 * a Workers isolate (no Node APIs, KV-backed cache OK, dynamic root-entry
 * import succeeds).
 */
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';

describe('Per-tenant schema resolution (Workers)', () => {
  it('imports buildPerTenantOpenApi from the root package entry', async () => {
    const mod = await import('../../src/index');
    expect(mod.buildPerTenantOpenApi).toBeTypeOf('function');
    expect(mod.wrapCacheStorageForOpenApi).toBeTypeOf('function');
  });

  it('emits a per-tenant OpenAPI document with the resolved schema', async () => {
    const {
      fromHono,
      defineModel,
      defineMeta,
      buildPerTenantOpenApi,
    } = await import('../../src/index');
    const { MemoryCreateEndpoint } = await import('../../src/adapters/memory/index');

    const Base = z.object({
      id: z.string().uuid(),
      title: z.string(),
    });
    const Extended = Base.extend({ priority: z.enum(['low', 'high']) });

    const Model = defineModel({
      tableName: 'tasks_edge',
      schema: Base,
      primaryKeys: ['id'],
      resolveSchema: (ctx) => (ctx.tenantId === 'tenant-x' ? Extended : Base),
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }

    const honoApp = new OpenAPIHono();
    const app = fromHono(honoApp);
    app.post('/tasks', TaskCreate);

    const docExt = await buildPerTenantOpenApi(app, { tenantId: 'tenant-x' });
    const docBase = await buildPerTenantOpenApi(app, { tenantId: 'other' });

    expect(JSON.stringify(docExt)).toContain('priority');
    expect(JSON.stringify(docBase)).not.toContain('priority');
  });

  it('caches per-tenant OpenAPI via a KV-backed adapter', async () => {
    const {
      fromHono,
      defineModel,
      defineMeta,
      buildPerTenantOpenApi,
      KVCacheStorage,
      wrapCacheStorageForOpenApi,
    } = await import('../../src/index');
    const { MemoryCreateEndpoint } = await import('../../src/adapters/memory/index');

    const Base = z.object({ id: z.string().uuid(), title: z.string() });

    let resolverCalls = 0;
    const Model = defineModel({
      tableName: 'tasks_kv_cache',
      schema: Base,
      primaryKeys: ['id'],
      resolveSchema: () => {
        resolverCalls++;
        return Base;
      },
    });
    const meta = defineMeta({ model: Model });
    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }

    const honoApp = new OpenAPIHono();
    const app = fromHono(honoApp);
    app.post('/tasks', TaskCreate);

    const cacheStorage = new KVCacheStorage({
      kv: env.CACHE_KV,
      prefix: 'openapi-cache:',
    });
    const cache = wrapCacheStorageForOpenApi(cacheStorage);

    await buildPerTenantOpenApi(app, { tenantId: 'kv-tenant' }, { cache });
    const after1 = resolverCalls;
    await buildPerTenantOpenApi(app, { tenantId: 'kv-tenant' }, { cache });
    expect(resolverCalls).toBe(after1);
  });
});
