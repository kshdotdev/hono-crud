/**
 * Nested `registerCrud` base paths (`/notes/:noteId/comments`): base-path
 * params are declared in the emitted doc, and a base-path param that shadows
 * a sub-route param (`/notes/:id/comments` + read → `/:id` twice) fails at
 * setup instead of silently reading the parent's id.
 */
import { MemoryAdapters, clearStorage } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  buildPerTenantOpenApi,
  defineEndpoints,
  defineMeta,
  defineModel,
  fromHono,
  registerCrud,
  toOpenApiPaths,
} from 'hono-crud';
import { pathParamNames } from 'hono-crud/core/path-params';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const CommentModel = defineModel({
  tableName: 'nested_comments',
  schema: z.object({ id: z.string(), noteId: z.string(), body: z.string() }),
  primaryKeys: ['id'],
});
const commentMeta = defineMeta({ model: CommentModel });

function commentEndpoints() {
  return defineEndpoints(
    { meta: commentMeta, create: {}, list: {}, read: {}, update: {}, delete: {} },
    MemoryAdapters,
  );
}

type Param = { name: string; in: string; required?: boolean };
type Doc = { paths?: Record<string, Record<string, { parameters?: Param[] }>> };

/** `'GET /notes/{noteId}/comments'` → its path param names, sorted. */
function pathParams(doc: Doc): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      const params = (op.parameters ?? []).filter((p) => p.in === 'path');
      for (const p of params) expect(p.required).toBe(true);
      out[`${method.toUpperCase()} ${path}`] = params.map((p) => p.name).sort();
    }
  }
  return out;
}

const info = { title: 't', version: '1' };

describe('base-path params are declared', () => {
  beforeEach(() => clearStorage());

  it('on every route of a nested registration, in 3.0 and 3.1', () => {
    const app = fromHono(new OpenAPIHono());
    registerCrud(app, '/notes/:noteId/comments', commentEndpoints());
    const expected = {
      'POST /notes/{noteId}/comments': ['noteId'],
      'GET /notes/{noteId}/comments': ['noteId'],
      'GET /notes/{noteId}/comments/{id}': ['id', 'noteId'],
      'PATCH /notes/{noteId}/comments/{id}': ['id', 'noteId'],
      'DELETE /notes/{noteId}/comments/{id}': ['id', 'noteId'],
    };
    expect(pathParams(app.getOpenAPIDocument({ openapi: '3.0.0', info }) as Doc)).toEqual(expected);
    expect(pathParams(app.getOpenAPI31Document({ openapi: '3.1.0', info }) as Doc)).toEqual(
      expected,
    );
  });

  it('keeps a user-declared params schema for the same name', () => {
    const app = fromHono(new OpenAPIHono());
    const endpoints = defineEndpoints(
      {
        meta: commentMeta,
        list: { openapi: { request: { params: z.object({ noteId: z.uuid() }) } } },
      },
      MemoryAdapters,
    );
    registerCrud(app, '/notes/:noteId/comments', endpoints);
    const doc = app.getOpenAPI31Document({ openapi: '3.1.0', info }) as {
      paths: Record<string, Record<string, { parameters: (Param & { schema: unknown })[] }>>;
    };
    const [param] = doc.paths['/notes/{noteId}/comments'].get.parameters;
    expect(param).toMatchObject({ name: 'noteId', schema: { type: 'string', format: 'uuid' } });
  });

  it('in the per-tenant doc and toOpenApiPaths', async () => {
    const app = fromHono(new OpenAPIHono());
    registerCrud(app, '/notes/:noteId/comments', { list: commentEndpoints().list });
    const tenantDoc = (await buildPerTenantOpenApi(app, { tenantId: 't1' })) as Doc;
    expect(pathParams(tenantDoc)).toEqual({ 'GET /notes/{noteId}/comments': ['noteId'] });

    const paths = toOpenApiPaths(commentEndpoints(), { basePath: '/notes/{noteId}/comments' });
    expect(pathParams({ paths } as Doc)['GET /notes/{noteId}/comments/{id}']).toEqual([
      'id',
      'noteId',
    ]);
  });

  it('templates a Hono-syntax toOpenApiPaths base path, matching the declared params', () => {
    const paths = toOpenApiPaths(commentEndpoints(), { basePath: '/notes/:noteId/comments' });
    expect(pathParams({ paths } as Doc)).toMatchObject({
      'GET /notes/{noteId}/comments': ['noteId'],
      'GET /notes/{noteId}/comments/{id}': ['id', 'noteId'],
    });
  });

  it('leaves an optional base-path param undeclared so requests that omit it pass', async () => {
    const app = fromHono(new OpenAPIHono());
    registerCrud(app, '/comments/:scope?', { list: commentEndpoints().list });
    expect((await app.request('/comments')).status).toBe(200);
    expect((await app.request('/comments/mine')).status).toBe(200);
  });

  it('reads the child id on a nested item route', async () => {
    const app = fromHono(new OpenAPIHono());
    registerCrud(app, '/notes/:noteId/comments', commentEndpoints());
    const created = await app.request('/notes/n1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: 'n1', body: 'hi' }),
    });
    expect(created.status).toBe(201);
    const { id } = ((await created.json()) as { result: { id: string } }).result;
    const res = await app.request(`/notes/n1/comments/${id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { id: string } }).result.id).toBe(id);
  });
});

describe('base-path param clash', () => {
  it('fails at setup when the base path reuses a sub-route param', () => {
    const app = fromHono(new OpenAPIHono());
    expect(() =>
      registerCrud(app, '/notes/:id/comments', { read: commentEndpoints().read }),
    ).toThrow(
      /registerCrud\(\): base path "\/notes\/:id\/comments" has a ":id" param, which the read route "\/notes\/:id\/comments\/:id" also uses.*":noteId"/,
    );
  });

  it('allows collection-only registrations under that base path', () => {
    const app = fromHono(new OpenAPIHono());
    expect(() =>
      registerCrud(app, '/notes/:id/comments', { list: commentEndpoints().list }),
    ).not.toThrow();
  });

  it('fails in toOpenApiPaths too', () => {
    expect(() => toOpenApiPaths(commentEndpoints(), { basePath: '/notes/{id}/comments' })).toThrow(
      /toOpenApiPaths\(\): base path/,
    );
  });
});

describe('pathParamNames', () => {
  it('reads Hono and OpenAPI param syntax', () => {
    expect(pathParamNames('/orgs/:orgId{[0-9]+}/projects/:projectId?/tasks/{taskId}')).toEqual([
      'orgId',
      'projectId',
      'taskId',
    ]);
  });
});
