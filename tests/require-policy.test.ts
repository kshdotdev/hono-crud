/**
 * Tests for `Model.policies` + `requirePolicy(...)` guard (0.7.0).
 *
 * Covers:
 *   - List: post-fetch `read` filtering, `fields` masking
 *   - List: `readPushdown` AND'd into the underlying filter conditions
 *   - Read: `read` denial yields 404 (don't leak existence)
 *   - Read: `fields` masking
 *   - Update / Delete: `write` denial yields 403
 *   - `requirePolicy(...)` middleware override beats `Model.policies` defaults
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';

import {
  fromHono,
  defineModel,
  defineMeta,
  requirePolicy,
  setContextVar,
  type ModelPolicies,
  type FilterCondition,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  clearStorage,
  getStore,
} from '../src/adapters/memory/index.js';

// ============================================================================
// Fixture
// ============================================================================

const PostSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  title: z.string(),
  draft: z.boolean().optional(),
});
type Post = z.infer<typeof PostSchema>;

// ============================================================================
// Suite
// ============================================================================

describe('Model.policies + requirePolicy', () => {
  beforeEach(() => clearStorage());

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------
  describe('list endpoint', () => {
    const policies: ModelPolicies<Post> = {
      // Only return posts authored by ctx.userId
      read: (ctx, post) => post.authorId === ctx.userId,
    };

    const Model = defineModel({
      tableName: 'posts_list',
      schema: PostSchema,
      primaryKeys: ['id'],
      policies,
    });
    const meta = defineMeta({ model: Model });

    class PostList extends MemoryListEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        // Pretend an upstream auth middleware put userId on the context.
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.get('/posts', PostList);
      return app;
    }

    it('filters out posts the read policy denies', async () => {
      const store = getStore<Post>('posts_list');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'Alice 1' });
      store.set('p2', { id: 'p2', authorId: 'alice', title: 'Alice 2' });
      store.set('p3', { id: 'p3', authorId: 'bob', title: 'Bob 1' });

      const app = buildApp();
      const res = await app.request('/posts', { headers: { 'x-user-id': 'alice' } });
      expect(res.status).toBe(200);
      const json = await res.json() as { result: Post[] };
      expect(json.result.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    });

    it('masks fields via policies.fields', async () => {
      const fieldsPolicies: ModelPolicies<Post> = {
        // Strip `title` for everyone (test fixture).
        fields: () => ({ title: '***' as never }),
      };

      const MaskedModel = defineModel({
        tableName: 'posts_mask',
        schema: PostSchema,
        primaryKeys: ['id'],
        policies: fieldsPolicies,
      });
      const maskedMeta = defineMeta({ model: MaskedModel });
      class MaskedList extends MemoryListEndpoint {
        _meta = maskedMeta;
      }

      const honoApp = new OpenAPIHono();
      const app = fromHono(honoApp);
      app.get('/posts', MaskedList);

      const store = getStore<Post>('posts_mask');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'secret' });

      const res = await app.request('/posts');
      const json = await res.json() as { result: Post[] };
      expect(json.result[0].title).toBe('***');
    });

    it('readPushdown injects FilterConditions into the query', async () => {
      let pushdownCalled = 0;
      const pushdownPolicies: ModelPolicies<Post> = {
        readPushdown: (ctx): FilterCondition[] => {
          pushdownCalled++;
          return [{ field: 'authorId', operator: 'eq', value: ctx.userId ?? '' }];
        },
      };

      const PushdownModel = defineModel({
        tableName: 'posts_push',
        schema: PostSchema,
        primaryKeys: ['id'],
        policies: pushdownPolicies,
      });
      const pushMeta = defineMeta({ model: PushdownModel });

      // Capture the filters the underlying list adapter receives.
      let observedFilters: FilterCondition[] = [];
      class PushList extends MemoryListEndpoint {
        _meta = pushMeta;
        override async list(filters: { filters: FilterCondition[] }) {
          observedFilters = [...filters.filters];
          return await super.list(filters as never);
        }
      }

      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.get('/posts', PushList);

      const store = getStore<Post>('posts_push');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'a' });
      store.set('p2', { id: 'p2', authorId: 'bob', title: 'b' });

      const res = await app.request('/posts', { headers: { 'x-user-id': 'alice' } });
      expect(res.status).toBe(200);
      expect(pushdownCalled).toBeGreaterThan(0);
      // The pushdown FilterCondition reached the adapter alongside any
      // tenant/middleware filters. Find ours.
      const fromPushdown = observedFilters.find(
        (f) => f.field === 'authorId' && f.value === 'alice'
      );
      expect(fromPushdown).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------
  describe('read endpoint', () => {
    const policies: ModelPolicies<Post> = {
      read: (ctx, post) => post.authorId === ctx.userId,
    };
    const Model = defineModel({
      tableName: 'posts_read',
      schema: PostSchema,
      primaryKeys: ['id'],
      policies,
    });
    const meta = defineMeta({ model: Model });

    class PostRead extends MemoryReadEndpoint {
      _meta = meta;
    }

    function buildApp() {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.get('/posts/:id', PostRead);
      return app;
    }

    it('returns 404 when policy denies the read', async () => {
      const store = getStore<Post>('posts_read');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'Alice secret' });

      const app = buildApp();
      const res = await app.request('/posts/p1', { headers: { 'x-user-id': 'bob' } });
      expect(res.status).toBe(404);
    });

    it('returns 200 when policy allows the read', async () => {
      const store = getStore<Post>('posts_read');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'Alice secret' });

      const app = buildApp();
      const res = await app.request('/posts/p1', { headers: { 'x-user-id': 'alice' } });
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // Update / Delete write-policy
  // --------------------------------------------------------------------------
  describe('update endpoint', () => {
    const policies: ModelPolicies<Post> = {
      write: (ctx, post) => post.authorId === ctx.userId,
    };
    const Model = defineModel({
      tableName: 'posts_upd',
      schema: PostSchema,
      primaryKeys: ['id'],
      policies,
    });
    const meta = defineMeta({ model: Model });

    class PostCreate extends MemoryCreateEndpoint {
      _meta = meta;
    }
    class PostUpdate extends MemoryUpdateEndpoint {
      _meta = meta;
    }

    it('returns 403 when write policy denies', async () => {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.post('/posts', PostCreate);
      app.patch('/posts/:id', PostUpdate);

      const store = getStore<Post>('posts_upd');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'Alice' });

      const res = await app.request('/posts/p1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'bob' },
        body: JSON.stringify({ title: 'hijack' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('delete endpoint', () => {
    const policies: ModelPolicies<Post> = {
      write: (ctx, post) => post.authorId === ctx.userId,
    };
    const Model = defineModel({
      tableName: 'posts_del',
      schema: PostSchema,
      primaryKeys: ['id'],
      policies,
    });
    const meta = defineMeta({ model: Model });

    class PostDelete extends MemoryDeleteEndpoint {
      _meta = meta;
    }

    it('returns 403 when write policy denies', async () => {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      app.delete('/posts/:id', PostDelete);

      const store = getStore<Post>('posts_del');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'Alice' });

      const res = await app.request('/posts/p1', {
        method: 'DELETE',
        headers: { 'x-user-id': 'bob' },
      });
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // requirePolicy(...) middleware overrides Model.policies
  // --------------------------------------------------------------------------
  describe('requirePolicy middleware', () => {
    const Model = defineModel({
      tableName: 'posts_mw',
      schema: PostSchema,
      primaryKeys: ['id'],
      // Default model policy permits everyone
      policies: { read: () => true },
    });
    const meta = defineMeta({ model: Model });

    class PostList extends MemoryListEndpoint {
      _meta = meta;
    }

    it('route-scoped policies override the model defaults', async () => {
      const honoApp = new OpenAPIHono();
      honoApp.use('/*', async (c, next) => {
        setContextVar(c, 'userId', c.req.header('x-user-id'));
        await next();
      });
      const app = fromHono(honoApp);
      // Stricter route-scoped policy: only alice's posts.
      app.get(
        '/posts',
        requirePolicy<Post>({
          read: (ctx, post) => post.authorId === ctx.userId,
        }),
        PostList
      );

      const store = getStore<Post>('posts_mw');
      store.set('p1', { id: 'p1', authorId: 'alice', title: 'A' });
      store.set('p2', { id: 'p2', authorId: 'bob', title: 'B' });

      const res = await app.request('/posts', { headers: { 'x-user-id': 'alice' } });
      const json = await res.json() as { result: Post[] };
      expect(json.result.map((p) => p.id)).toEqual(['p1']);
    });
  });
});
