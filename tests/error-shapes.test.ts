/**
 * Error-shape unification pins (refactor/error-shapes) — one test per defector.
 *
 * Covers:
 *   - Write-policy denial → 403 `FORBIDDEN` canonical envelope (was a bare
 *     HTTPException flattened to `HTTP_ERROR`).
 *   - Missing tenant → 400 `TENANT_REQUIRED` via BOTH the `multiTenant`
 *     middleware and the base.ts endpoint gate (`validateTenantId`).
 *   - Invalid tenant (`validate()` → false) → 400 `INVALID_TENANT`; the
 *     `onMissing` and `required: false` escape hatches stay intact.
 *   - Aggregation denials (allow-list, groupBy max, limit max) → 400
 *     `AGGREGATION_ERROR` (were 500 `INTERNAL_ERROR` / `VALIDATION_ERROR`).
 *   - Search sub-minimum query → 400 `INVALID_QUERY` canonical envelope.
 *   - Validation through the installed defaultHook and through the
 *     resolved-schema throw (base.ts) produce the IDENTICAL body shape.
 *   - Bare app without `createErrorHandler` → canonical JSON via the new
 *     `ApiException.getResponse()` override (was text/plain).
 *   - Falsy `details` (0, '', false) survive serialization.
 *   - list/export declare a 400 in the generated OpenAPI document.
 *   - Deleted error-shape exports are gone from the barrel; canonical
 *     replacements are exported.
 */

import {
  MemoryAdapters,
  MemoryAggregateEndpoint,
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemorySearchEndpoint,
  MemoryUpdateEndpoint,
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import {
  ApiException,
  type ModelPolicies,
  defineEndpoints,
  defineMeta,
  defineModel,
  fromHono,
  setContextVar,
  toOpenApiPaths,
  validationIssueSchema,
} from 'hono-crud';
import * as honoCrudBarrel from 'hono-crud';
import { multiTenant } from 'hono-crud/multi-tenant';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/** Canonical error envelope as it appears on the wire. */
interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

describe('error-shape unification', () => {
  beforeEach(() => clearStorage());

  // --------------------------------------------------------------------------
  // Write-policy denial → 403 FORBIDDEN (base.ts applyWritePolicy)
  // --------------------------------------------------------------------------
  describe('write-policy denial', () => {
    const PostSchema = z.object({
      id: z.uuid(),
      authorId: z.string(),
      title: z.string(),
    });
    type Post = z.infer<typeof PostSchema>;

    const policies: ModelPolicies<Post> = {
      write: (ctx, post) => post.authorId === ctx.userId,
    };
    const PostModel = defineModel({
      tableName: 'errshapes_policy',
      schema: PostSchema,
      primaryKeys: ['id'],
      policies,
    });
    const postMeta = defineMeta({ model: PostModel });

    class PostUpdate extends MemoryUpdateEndpoint {
      _meta = postMeta;
    }

    it('denied update → 403 with the canonical FORBIDDEN envelope', async () => {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.patch('/posts/:id', PostUpdate);

      getStore<Post>('errshapes_policy').set('p1', {
        id: 'p1',
        authorId: 'alice',
        title: 'Alice',
      });

      const res = await app.request('/posts/p1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'bob' },
        body: JSON.stringify({ title: 'hijack' }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Forbidden by policy' },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Tenant gates → 400 TENANT_REQUIRED / 400 INVALID_TENANT
  // --------------------------------------------------------------------------
  describe('tenant gates', () => {
    it('multiTenant middleware: missing required tenant → 400 TENANT_REQUIRED', async () => {
      const app = new Hono();
      app.use('/*', multiTenant());
      app.get('/ping', (c) => c.json({ ok: true }));

      const res = await app.request('/ping');

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: { code: 'TENANT_REQUIRED', message: 'Tenant ID is required' },
      });
    });

    it('multiTenant middleware: validate() false → 400 INVALID_TENANT', async () => {
      const app = new Hono();
      app.use('/*', multiTenant({ validate: (tenantId) => tenantId === 'tenant-good' }));
      app.get('/ping', (c) => c.json({ ok: true }));

      const res = await app.request('/ping', {
        headers: { 'X-Tenant-ID': 'tenant-bad' },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: { code: 'INVALID_TENANT', message: 'Invalid tenant ID' },
      });
    });

    it('multiTenant middleware: onMissing still returns its custom Response', async () => {
      const app = new Hono();
      app.use('/*', multiTenant({ onMissing: (c) => c.text('who are you?', 401) }));
      app.get('/ping', (c) => c.json({ ok: true }));

      const res = await app.request('/ping');

      expect(res.status).toBe(401);
      expect(await res.text()).toBe('who are you?');
    });

    it('multiTenant middleware: required: false passes through without a tenant', async () => {
      const app = new Hono();
      app.use('/*', multiTenant({ required: false }));
      app.get('/ping', (c) => c.json({ ok: true }));

      const res = await app.request('/ping');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('base.ts endpoint gate: missing required tenant → 400 TENANT_REQUIRED', async () => {
      const DocSchema = z.object({
        id: z.uuid(),
        tenantId: z.string(),
        title: z.string(),
      });
      const DocModel = defineModel({
        tableName: 'errshapes_tenant_gate',
        schema: DocSchema,
        primaryKeys: ['id'],
        multiTenant: true,
      });
      const docMeta = defineMeta({ model: DocModel });
      class DocList extends MemoryListEndpoint {
        _meta = docMeta;
      }

      // No multiTenant middleware: the endpoint's own validateTenantId()
      // gate fires (model source defaults to 'context', required: true).
      const app = fromHono(new OpenAPIHono());
      app.get('/docs', DocList);

      const res = await app.request('/docs');

      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: { code: 'TENANT_REQUIRED', message: 'Tenant ID is required' },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Aggregate denials → 400 AGGREGATION_ERROR
  // --------------------------------------------------------------------------
  describe('aggregate denials', () => {
    const ProductSchema = z.object({
      id: z.uuid(),
      name: z.string(),
      category: z.string(),
      price: z.number(),
    });
    const ProductModel = defineModel({
      tableName: 'errshapes_aggregate',
      schema: ProductSchema,
      primaryKeys: ['id'],
    });
    const productMeta = defineMeta({ model: ProductModel });

    class ProductAggregate extends MemoryAggregateEndpoint {
      _meta = productMeta;
      aggregateConfig = {
        sumFields: ['price'],
        groupByFields: ['category'],
      };
    }

    function buildApp() {
      const app = fromHono(new OpenAPIHono());
      app.get('/products/aggregate', ProductAggregate);
      return app;
    }

    it('disallowed SUM field → 400 AGGREGATION_ERROR (was 500 INTERNAL_ERROR)', async () => {
      const res = await buildApp().request('/products/aggregate?sum=name');

      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: {
          code: 'AGGREGATION_ERROR',
          message: "Field 'name' is not allowed for SUM aggregation",
        },
      });
    });

    it('groupBy over the max → 400 AGGREGATION_ERROR (was VALIDATION_ERROR)', async () => {
      const res = await buildApp().request(
        '/products/aggregate?count=*&groupBy=a,b,c,d,e,f', // 6 > default max of 5
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe('AGGREGATION_ERROR');
      expect(body.error.message).toBe('Maximum 5 GROUP BY fields allowed');
    });

    it('limit > maxLimit → 400 AGGREGATION_ERROR (bare app, getResponse fallback)', async () => {
      // Direct mount on a bare Hono app (mirrors tests/aggregate.test.ts) so
      // the raw string `limit` reaches parseAggregateQuery; no onError wired,
      // so the canonical body comes from ApiException.getResponse().
      const app = new Hono();
      app.get('/products/aggregate', async (c) => {
        const endpoint = new ProductAggregate();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      const res = await app.request('/products/aggregate?count=*&limit=5000');

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe('AGGREGATION_ERROR');
      expect(body.error.message).toBe('Limit cannot exceed 1000');
    });
  });

  // --------------------------------------------------------------------------
  // Search min-query gate → 400 INVALID_QUERY
  // --------------------------------------------------------------------------
  describe('search min-query gate', () => {
    const ArticleSchema = z.object({
      id: z.uuid(),
      title: z.string(),
      content: z.string(),
    });
    const ArticleModel = defineModel({
      tableName: 'errshapes_search',
      schema: ArticleSchema,
      primaryKeys: ['id'],
    });
    const articleMeta = defineMeta({ model: ArticleModel });

    class ArticleSearch extends MemorySearchEndpoint {
      _meta = articleMeta;
      protected searchableFields = {
        title: { weight: 2.0 },
        content: { weight: 1.0 },
      };
    }

    it('sub-minimum query → 400 INVALID_QUERY canonical envelope (previously a bypassing inline json)', async () => {
      // Bare app, no onError: the throw is shaped by ApiException.getResponse().
      const app = new Hono();
      app.get('/articles/search', async (c) => {
        const endpoint = new ArticleSearch();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      const res = await app.request('/articles/search?q=a');

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as ErrorBody;
      expect(body).toEqual({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Search query must be at least 2 characters',
        },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Validation: defaultHook path and resolved-schema throw path are identical
  // --------------------------------------------------------------------------
  describe('validation: hook path and thrown path emit the identical shape', () => {
    const TENANT_EXT = 'tenant-ext-uuid';

    // Hook path: static schema fails inside the installed defaultHook.
    const StaticSchema = z.object({ id: z.uuid(), title: z.string() });
    const StaticModel = defineModel({
      tableName: 'errshapes_val_static',
      schema: StaticSchema,
      primaryKeys: ['id'],
    });
    const staticMeta = defineMeta({ model: StaticModel });
    class StaticCreate extends MemoryCreateEndpoint {
      _meta = staticMeta;
    }

    // Thrown path: body passes the static schema, fails the per-tenant
    // resolved schema → InputValidationException thrown from base.ts.
    const ResolvedBaseSchema = z.object({
      id: z.uuid(),
      tenantId: z.uuid(),
      title: z.string(),
    });
    const ResolvedExtSchema = ResolvedBaseSchema.extend({
      priority: z.enum(['low', 'high']),
    });
    const ResolvedModel = defineModel({
      tableName: 'errshapes_val_resolved',
      schema: ResolvedBaseSchema,
      primaryKeys: ['id'],
      multiTenant: true,
      resolveSchema: (ctx) =>
        ctx.tenantId === TENANT_EXT ? ResolvedExtSchema : ResolvedBaseSchema,
    });
    const resolvedMeta = defineMeta({ model: ResolvedModel });
    class ResolvedCreate extends MemoryCreateEndpoint {
      _meta = resolvedMeta;
    }

    it('both layers return 400 with the same VALIDATION_ERROR envelope shape', async () => {
      // (a) hook path — no onError wired, body shaped by getResponse().
      const staticApp = fromHono(new OpenAPIHono());
      staticApp.post('/tasks', StaticCreate);
      const hookRes = await staticApp.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // missing `title`
      });

      // (b) thrown path — resolved schema demands `priority` for TENANT_EXT.
      const resolvedHono = new OpenAPIHono();
      resolvedHono.use('/*', multiTenant({ contextKey: 'tenantId' }));
      const resolvedApp = fromHono(resolvedHono);
      resolvedApp.post('/tasks', ResolvedCreate);
      const thrownRes = await resolvedApp.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT_EXT },
        body: JSON.stringify({ title: 'no priority' }), // passes static, fails resolved
      });

      expect(hookRes.status).toBe(400);
      expect(thrownRes.status).toBe(400);

      const hookBody = (await hookRes.json()) as ErrorBody;
      const thrownBody = (await thrownRes.json()) as ErrorBody;

      // Identical envelope shape: same keys at every level, same code and
      // message; only the offending field differs.
      expect(Object.keys(hookBody).sort()).toEqual(Object.keys(thrownBody).sort());
      expect(Object.keys(hookBody.error).sort()).toEqual(Object.keys(thrownBody.error).sort());
      expect(hookBody.success).toBe(false);
      expect(thrownBody.success).toBe(false);
      expect(hookBody.error.code).toBe('VALIDATION_ERROR');
      expect(thrownBody.error.code).toBe('VALIDATION_ERROR');
      expect(hookBody.error.message).toBe('Validation failed');
      expect(thrownBody.error.message).toBe('Validation failed');

      for (const body of [hookBody, thrownBody]) {
        const details = body.error.details as Array<Record<string, unknown>>;
        expect(Array.isArray(details)).toBe(true);
        expect(details.length).toBeGreaterThan(0);
        for (const issue of details) {
          expect(validationIssueSchema.safeParse(issue).success).toBe(true);
          expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
        }
      }

      const hookDetails = hookBody.error.details as Array<{ path: string }>;
      const thrownDetails = thrownBody.error.details as Array<{ path: string }>;
      expect(hookDetails[0].path).toBe('title');
      expect(thrownDetails[0].path).toBe('priority');
    });
  });

  // --------------------------------------------------------------------------
  // getResponse() fallback: bare app, no createErrorHandler
  // --------------------------------------------------------------------------
  describe('ApiException.getResponse() fallback', () => {
    it('thrown ApiException on an app with no onError → canonical JSON (was text/plain)', async () => {
      const app = new Hono();
      app.use('/*', async () => {
        throw new ApiException("I'm a teapot", 418, 'TEAPOT', { brew: 'oolong' });
      });
      app.get('/anything', (c) => c.json({ ok: true }));

      const res = await app.request('/anything');

      expect(res.status).toBe(418);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'TEAPOT', message: "I'm a teapot", details: { brew: 'oolong' } },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Falsy details survive serialization
  // --------------------------------------------------------------------------
  describe('falsy details serialization', () => {
    it('keeps falsy details (0, "", false) in toJSON()', () => {
      expect(new ApiException('x', 400, 'C', 0).toJSON().error.details).toBe(0);
      expect(new ApiException('x', 400, 'C', '').toJSON().error.details).toBe('');
      expect(new ApiException('x', 400, 'C', false).toJSON().error.details).toBe(false);
    });

    it('keeps falsy details on the wire via getResponse()', async () => {
      const res = new ApiException('x', 400, 'C', 0).getResponse();
      const body = (await res.json()) as ErrorBody;
      expect(body.error.details).toBe(0);
    });

    it('omits the details key entirely when undefined', () => {
      expect('details' in new ApiException('x', 400, 'C').toJSON().error).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // list/export declare a 400 in the generated OpenAPI
  // --------------------------------------------------------------------------
  describe('declared 400s for failable query schemas', () => {
    it('list and export both declare a 400 response', () => {
      const WidgetSchema = z.object({ id: z.uuid(), name: z.string() });
      const WidgetModel = defineModel({
        tableName: 'errshapes_openapi',
        schema: WidgetSchema,
        primaryKeys: ['id'],
      });
      const endpoints = defineEndpoints(
        { meta: defineMeta({ model: WidgetModel }), list: {}, export: {} },
        MemoryAdapters,
      );

      const paths = toOpenApiPaths(endpoints);
      const listOp = paths['/'].get as { responses: Record<string, { description?: string }> };
      const exportOp = paths['/export'].get as {
        responses: Record<string, { description?: string }>;
      };

      expect(listOp.responses['400']).toBeDefined();
      expect(listOp.responses['400'].description).toBe('Validation error');
      expect(exportOp.responses['400']).toBeDefined();
      expect(exportOp.responses['400'].description).toBe('Validation error');
    });
  });

  // --------------------------------------------------------------------------
  // Barrel: deleted exports gone, canonical replacements present
  // --------------------------------------------------------------------------
  describe('barrel exports', () => {
    const barrel = honoCrudBarrel as Record<string, unknown>;

    it('removes the deleted error-shape exports', () => {
      const deleted = [
        'createErrorSchema',
        'createOneOfErrorSchema',
        'httpErrorContent',
        'commonResponses',
        'ZodIssueSchema',
        'ZodErrorSchema',
        'HttpErrorSchema',
        'successResponse',
        'errorResponse',
      ];
      for (const name of deleted) {
        expect(barrel[name], `expected '${name}' to be deleted from the barrel`).toBeUndefined();
      }
    });

    it('exports the canonical replacements', () => {
      const kept = [
        'errorResponseZodSchema',
        'errorResponseSchema',
        'errorResponses',
        'validationIssueSchema',
        'openApiValidationHook',
        'createValidationHook',
        'jsonContent',
        'jsonContentRequired',
        'registerCrud',
        'contentJson',
      ];
      for (const name of kept) {
        expect(barrel[name], `expected '${name}' to be exported from the barrel`).toBeDefined();
      }
    });
  });
});
