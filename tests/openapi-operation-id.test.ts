/**
 * Default OpenAPI `operationId`s for `registerCrud` routes (#151): derived
 * from the endpoint slot and the registered base path, asserted on the
 * emitted 3.0 and 3.1 documents.
 */
import { MemoryAdapters } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  type OperationIdContext,
  type RouterOptions,
  buildPerTenantOpenApi,
  defineEndpoints,
  defineMeta,
  defineModel,
  fromHono,
  registerCrud,
  toOpenApiPaths,
} from 'hono-crud';
import { CRUD_ROUTES } from 'hono-crud/core/crud-routes';
import { defaultOperationId, singularize } from 'hono-crud/core/operation-id';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const CommentModel = defineModel({
  tableName: 'comments',
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

type Operation = { operationId?: string };
type Doc = { paths?: Record<string, Record<string, Operation>> };

/** `'GET /comments/{id}'` → operationId, from both the 3.0 and 3.1 generators. */
function operationIds(app: OpenAPIHono): Record<string, string | undefined> {
  const info = { title: 't', version: '1' };
  const docs = [
    app.getOpenAPIDocument({ openapi: '3.0.0', info }) as Doc,
    app.getOpenAPI31Document({ openapi: '3.1.0', info }) as Doc,
  ];
  const [v30, v31] = docs.map((doc) => {
    const ids: Record<string, string | undefined> = {};
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item)) {
        ids[`${method.toUpperCase()} ${path}`] = op.operationId;
      }
    }
    return ids;
  });
  expect(v30).toEqual(v31);
  return v31;
}

function newApp(options?: RouterOptions) {
  return fromHono(new OpenAPIHono(), options);
}

describe('default operationId', () => {
  it('names the five core verbs of a top-level resource', () => {
    const app = newApp();
    registerCrud(app, '/comments', commentEndpoints());
    expect(operationIds(app)).toEqual({
      'POST /comments': 'createComment',
      'GET /comments': 'listComments',
      'GET /comments/{id}': 'getComment',
      'PATCH /comments/{id}': 'updateComment',
      'DELETE /comments/{id}': 'deleteComment',
    });
  });

  it('qualifies nested and prefixed base paths so ids stay unique', () => {
    const endpoints = commentEndpoints();
    const app = newApp();
    registerCrud(app, '/comments', { list: endpoints.list });
    registerCrud(app, '/notes/:noteId/comments', { list: endpoints.list });
    registerCrud(app, '/admin/comments', { list: endpoints.list });
    expect(operationIds(app)).toEqual({
      'GET /comments': 'listComments',
      'GET /notes/{noteId}/comments': 'listNoteComments',
      'GET /admin/comments': 'listAdminComments',
    });
  });

  it('keeps the id stable when the app is mounted under a prefix', () => {
    const sub = newApp();
    registerCrud(sub, '/comments', { list: commentEndpoints().list });
    const root = new OpenAPIHono();
    root.route('/api', sub);
    expect(operationIds(root)).toEqual({ 'GET /api/comments': 'listComments' });
  });

  it('lets an explicit schema.operationId win', () => {
    const app = newApp();
    const endpoints = defineEndpoints(
      { meta: commentMeta, list: { openapi: { operationId: 'browseComments' } } },
      MemoryAdapters,
    );
    registerCrud(app, '/comments', endpoints);
    expect(operationIds(app)).toEqual({ 'GET /comments': 'browseComments' });
  });

  it('emits no default for routes registered outside registerCrud', () => {
    const app = newApp();
    app.get('/comments', commentEndpoints().list);
    expect(operationIds(app)).toEqual({ 'GET /comments': undefined });
  });

  it('emits no default with operationIds: false', () => {
    const app = newApp({ operationIds: false });
    registerCrud(app, '/comments', commentEndpoints());
    expect(Object.values(operationIds(app))).toEqual(Array(5).fill(undefined));
  });

  it('fails at setup when a generated id duplicates another id', () => {
    const app = newApp();
    const clash = defineEndpoints(
      { meta: commentMeta, list: { openapi: { operationId: 'listComments' } } },
      MemoryAdapters,
    );
    registerCrud(app, '/archived-comments', clash);
    expect(() => registerCrud(app, '/comments', commentEndpoints())).toThrow(
      /operationId "listComments" is used by both GET \/archived-comments and GET \/comments/,
    );
  });

  it('leaves duplicates between two explicit ids alone', () => {
    const app = newApp();
    const explicit = defineEndpoints(
      { meta: commentMeta, list: { openapi: { operationId: 'sameId' } } },
      MemoryAdapters,
    );
    registerCrud(app, '/a', explicit);
    expect(() => registerCrud(app, '/b', explicit)).not.toThrow();
  });

  it('matches the live doc in the per-tenant doc', async () => {
    const app = newApp();
    registerCrud(app, '/comments', commentEndpoints());
    const doc = (await buildPerTenantOpenApi(app, { tenantId: 't1' })) as Doc;
    expect(doc.paths?.['/comments/{id}']?.get?.operationId).toBe('getComment');
    expect(doc.paths?.['/comments']?.get?.operationId).toBe('listComments');
  });
});

describe('operationIds naming function', () => {
  it('receives the route context and names the operation', () => {
    const seen: OperationIdContext[] = [];
    const app = newApp({
      operationIds: (ctx) => {
        seen.push(ctx);
        return ctx.defaultId && `v2${ctx.defaultId[0].toUpperCase()}${ctx.defaultId.slice(1)}`;
      },
    });
    registerCrud(app, '/notes/:noteId/comments', commentEndpoints());
    expect(operationIds(app)['GET /notes/{noteId}/comments/{id}']).toBe('v2GetNoteComment');
    expect(seen.find((ctx) => ctx.operation === 'read')).toEqual({
      operation: 'read',
      method: 'get',
      path: '/notes/:noteId/comments/:id',
      basePath: '/notes/:noteId/comments',
      model: CommentModel,
      defaultId: 'getNoteComment',
    });
  });

  it('omits the id when the function returns undefined', () => {
    const app = newApp({
      operationIds: ({ operation }) => (operation === 'list' ? undefined : operation),
    });
    registerCrud(app, '/comments', {
      list: commentEndpoints().list,
      read: commentEndpoints().read,
    });
    expect(operationIds(app)).toEqual({ 'GET /comments': undefined, 'GET /comments/{id}': 'read' });
  });

  it('still loses to an explicit schema.operationId', () => {
    const app = newApp({ operationIds: () => 'fromStrategy' });
    const endpoints = defineEndpoints(
      { meta: commentMeta, list: { openapi: { operationId: 'explicit' } } },
      MemoryAdapters,
    );
    registerCrud(app, '/comments', endpoints);
    expect(operationIds(app)).toEqual({ 'GET /comments': 'explicit' });
  });

  it('fails at setup when the function returns a duplicate', () => {
    const app = newApp({ operationIds: () => 'same' });
    expect(() => registerCrud(app, '/comments', commentEndpoints())).toThrow(
      /operationId "same" is used by both POST \/comments and GET \/comments/,
    );
  });

  it('applies to toOpenApiPaths too', () => {
    const paths = toOpenApiPaths(commentEndpoints(), {
      basePath: '/comments',
      operationIds: ({ operation, method }) => `${method}_${operation}`,
    });
    expect((paths['/comments']?.get as Operation).operationId).toBe('get_list');
  });
});

describe('toOpenApiPaths operationId', () => {
  const idsOf = (paths: Record<string, Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(paths).flatMap(([path, item]) =>
        Object.entries(item).map(([method, op]) => [
          `${method.toUpperCase()} ${path}`,
          (op as Operation).operationId,
        ]),
      ),
    );

  it('matches registerCrud for the same base path', () => {
    const app = newApp();
    registerCrud(app, '/notes/:noteId/comments', commentEndpoints());
    const fromApp = Object.values(operationIds(app));
    const fragment = idsOf(
      toOpenApiPaths(commentEndpoints(), { basePath: '/notes/{noteId}/comments' }),
    );
    expect(Object.values(fragment)).toEqual(fromApp);
    expect(fragment['GET /notes/{noteId}/comments']).toBe('listNoteComments');
  });

  it('derives the resource from tableName without a base path', () => {
    const fragment = idsOf(toOpenApiPaths(commentEndpoints()));
    expect(fragment).toEqual({
      'POST /': 'createComment',
      'GET /': 'listComments',
      'GET /{id}': 'getComment',
      'PATCH /{id}': 'updateComment',
      'DELETE /{id}': 'deleteComment',
    });
  });

  it('emits no default with operationIds: false', () => {
    const fragment = idsOf(toOpenApiPaths(commentEndpoints(), { operationIds: false }));
    expect(Object.values(fragment)).toEqual(Array(5).fill(undefined));
  });
});

describe('defaultOperationId naming rules', () => {
  it('names every registerCrud slot', () => {
    const ids = Object.fromEntries(
      CRUD_ROUTES.map(([name]) => [name, defaultOperationId(name, '/comments')]),
    );
    expect(ids).toEqual({
      create: 'createComment',
      list: 'listComments',
      batchCreate: 'batchCreateComments',
      batchUpdate: 'batchUpdateComments',
      batchDelete: 'batchDeleteComments',
      batchRestore: 'batchRestoreComments',
      batchUpsert: 'batchUpsertComments',
      search: 'searchComments',
      aggregate: 'aggregateComments',
      export: 'exportComments',
      import: 'importComments',
      upsert: 'upsertComment',
      bulkPatch: 'bulkPatchComments',
      read: 'getComment',
      update: 'updateComment',
      delete: 'deleteComment',
      restore: 'restoreComment',
      clone: 'cloneComment',
      versionHistory: 'listCommentVersions',
      versionCompare: 'compareCommentVersions',
      versionRead: 'getCommentVersion',
      versionRollback: 'rollbackCommentVersion',
    });
  });

  it('singularizes with a small frozen rule set', () => {
    expect(
      ['categories', 'addresses', 'boxes', 'matches', 'status', 'analysis', 'people', 'news'].map(
        singularize,
      ),
    ).toEqual(['category', 'address', 'box', 'match', 'status', 'analysis', 'people', 'news']);
  });

  it('camelCases kebab and snake segments and ignores param syntax', () => {
    expect(defaultOperationId('read', '/user-profiles')).toBe('getUserProfile');
    expect(defaultOperationId('list', '/user_settings')).toBe('listUserSettings');
    expect(defaultOperationId('list', '/orgs/:orgId{[0-9]+}/projects/:projectId/tasks')).toBe(
      'listOrgProjectTasks',
    );
  });

  it('falls back to the table name when the base path has no static segment', () => {
    expect(defaultOperationId('list', '', 'audit_log')).toBe('listAuditLog');
    expect(defaultOperationId('read', '/:tenant', 'categories')).toBe('getCategory');
    expect(defaultOperationId('read', '')).toBeUndefined();
  });
});
