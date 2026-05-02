/**
 * Tests for `Model.resolveSchema(ctx)` (0.6.0).
 *
 * Covers:
 *   1. BC: model without a resolver behaves identically to pre-0.6.0.
 *   2. Tenant-conditional schema: per-tenant required fields are enforced.
 *   3. Per-tenant OpenAPI: `buildPerTenantOpenApi` reflects the resolved schema.
 *   4. Per-request memoization: the resolver is invoked at most once per
 *      request, even when multiple endpoint methods read the schema.
 *   5. Resolver throws → structured 500 (`SCHEMA_RESOLVE_ERROR`), not a crash.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  fromHono,
  defineModel,
  defineMeta,
  multiTenant,
  buildPerTenantOpenApi,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TENANT_EXT = 'tenant-ext-uuid';
const TENANT_BASE = 'tenant-base-uuid';

const BaseTaskSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  title: z.string(),
});

const ExtendedTaskSchema = BaseTaskSchema.extend({
  priority: z.enum(['low', 'high']),
});

// ============================================================================
// Suite: behaviors
// ============================================================================

describe('Model.resolveSchema', () => {
  beforeEach(() => {
    clearStorage();
  });

  // --------------------------------------------------------------------------
  // 1. Backwards compatibility
  // --------------------------------------------------------------------------
  describe('BC: no resolver', () => {
    const Model = defineModel({
      tableName: 'tasks_bc',
      schema: BaseTaskSchema,
      primaryKeys: ['id'],
      multiTenant: true,
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }
    class TaskList extends MemoryListEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
      const app = fromHono(honoApp);
      app.post('/tasks', TaskCreate);
      app.get('/tasks', TaskList);
      return app;
    }

    it('validates against static schema and accepts a basic body', async () => {
      const app = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_BASE,
        },
        body: JSON.stringify({ title: 'hello' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { result: { title: string } };
      expect(json.result.title).toBe('hello');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Tenant-conditional schema
  // --------------------------------------------------------------------------
  describe('tenant-conditional schema', () => {
    const Model = defineModel({
      tableName: 'tasks_cond',
      schema: BaseTaskSchema,
      primaryKeys: ['id'],
      multiTenant: true,
      resolveSchema: (ctx) =>
        ctx.tenantId === TENANT_EXT ? ExtendedTaskSchema : BaseTaskSchema,
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
      const app = fromHono(honoApp);
      app.post('/tasks', TaskCreate);
      return app;
    }

    it('rejects body missing per-tenant required field for the extended tenant', async () => {
      const app = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_EXT,
        },
        body: JSON.stringify({ title: 'no priority' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json() as {
        error: { code: string; details: unknown };
      };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts body with the per-tenant required field for the extended tenant', async () => {
      const app = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_EXT,
        },
        body: JSON.stringify({ title: 'with priority', priority: 'high' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { result: { priority?: string } };
      expect(json.result.priority).toBe('high');
    });

    it('accepts the basic body for the base tenant (no extra field required)', async () => {
      const app = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_BASE,
        },
        body: JSON.stringify({ title: 'basic' }),
      });
      expect(res.status).toBe(201);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Per-tenant OpenAPI emission
  // --------------------------------------------------------------------------
  describe('buildPerTenantOpenApi', () => {
    const Model = defineModel({
      tableName: 'tasks_openapi',
      schema: BaseTaskSchema,
      primaryKeys: ['id'],
      resolveSchema: (ctx) =>
        ctx.tenantId === TENANT_EXT ? ExtendedTaskSchema : BaseTaskSchema,
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      const app = fromHono(honoApp);
      app.post('/tasks', TaskCreate);
      return app;
    }

    it('emits the extended schema for the extending tenant', async () => {
      const app = buildApp();
      const doc = await buildPerTenantOpenApi(app, { tenantId: TENANT_EXT }) as {
        components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
      };
      // The body schema appears in the request.body.content['application/json'].schema
      // for POST /tasks. For simplicity here we assert the extended `priority`
      // appears anywhere in the serialised document.
      const serialised = JSON.stringify(doc);
      expect(serialised).toContain('priority');
    });

    it('does not emit the extension for the base tenant', async () => {
      const app = buildApp();
      const doc = await buildPerTenantOpenApi(app, { tenantId: TENANT_BASE });
      const serialised = JSON.stringify(doc);
      expect(serialised).not.toContain('priority');
    });

    it('caches per-tenant docs when a cache is provided', async () => {
      const app = buildApp();
      const cache = new Map<string, unknown>();
      const cacheAdapter = {
        get(k: string) {
          return cache.get(k);
        },
        set(k: string, v: unknown) {
          cache.set(k, v);
        },
      };
      let resolverCount = 0;
      const InstrumentedModel = defineModel({
        tableName: 'tasks_cache',
        schema: BaseTaskSchema,
        primaryKeys: ['id'],
        resolveSchema: (ctx) => {
          resolverCount++;
          return ctx.tenantId === TENANT_EXT ? ExtendedTaskSchema : BaseTaskSchema;
        },
      });
      const cachedMeta = defineMeta({ model: InstrumentedModel });
      class CachedCreate extends MemoryCreateEndpoint {
        _meta = cachedMeta;
      }
      const honoApp = new OpenAPIHono();
      const cachedApp = fromHono(honoApp);
      cachedApp.post('/tasks', CachedCreate);

      await buildPerTenantOpenApi(cachedApp, { tenantId: TENANT_EXT }, { cache: cacheAdapter });
      const callsAfterFirst = resolverCount;
      await buildPerTenantOpenApi(cachedApp, { tenantId: TENANT_EXT }, { cache: cacheAdapter });
      // Second call should hit the cache, not re-invoke the resolver.
      expect(resolverCount).toBe(callsAfterFirst);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Per-request memoization
  // --------------------------------------------------------------------------
  describe('per-request memoization', () => {
    let resolverCount = 0;

    const Model = defineModel({
      tableName: 'tasks_memo',
      schema: BaseTaskSchema,
      primaryKeys: ['id'],
      multiTenant: true,
      resolveSchema: () => {
        resolverCount++;
        return BaseTaskSchema;
      },
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }
    class TaskList extends MemoryListEndpoint {
      _meta = meta;
    }

    beforeEach(() => {
      resolverCount = 0;
    });

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
      const app = fromHono(honoApp);
      app.post('/tasks', TaskCreate);
      app.get('/tasks', TaskList);
      return app;
    }

    it('invokes the resolver at most once per request', async () => {
      const app = buildApp();
      // A single request that triggers body validation (which calls the
      // resolver once); the body re-validation step inside getValidatedData
      // must NOT re-invoke the resolver, it must read from the c.var cache.
      await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_BASE,
        },
        body: JSON.stringify({ title: 'memo-check' }),
      });
      expect(resolverCount).toBe(1);
    });

    it('invokes the resolver again on the next request', async () => {
      const app = buildApp();
      await app.request('/tasks', {
        method: 'GET',
        headers: { 'X-Tenant-ID': TENANT_BASE },
      });
      const after1 = resolverCount;
      await app.request('/tasks', {
        method: 'GET',
        headers: { 'X-Tenant-ID': TENANT_BASE },
      });
      // Two distinct requests — resolver is called once per request, so the
      // count grows by one. Memoization is per-request, not global.
      expect(resolverCount).toBe(after1 + 1);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Resolver errors
  // --------------------------------------------------------------------------
  describe('resolver errors', () => {
    const Model = defineModel({
      tableName: 'tasks_err',
      schema: BaseTaskSchema,
      primaryKeys: ['id'],
      multiTenant: true,
      resolveSchema: () => {
        throw new Error('resolver-bang');
      },
    });
    const meta = defineMeta({ model: Model });

    class TaskCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', multiTenant({ contextKey: 'tenantId' }));
      const app = fromHono(honoApp);
      app.post('/tasks', TaskCreate);
      return app;
    }

    it('returns a structured 500 with code SCHEMA_RESOLVE_ERROR', async () => {
      const app = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT_BASE,
        },
        body: JSON.stringify({ title: 'kapow' }),
      });
      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('SCHEMA_RESOLVE_ERROR');
      expect(json.error.message).toContain('resolver-bang');
    });
  });
});
