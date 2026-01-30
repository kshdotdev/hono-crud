import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { MiddlewareHandler, Context, Next } from 'hono';
import type { MetaInput } from '../src/index';
import {
  fromHono,
  registerCrud,
  crud,
  createCreate,
  createList,
} from '../src/index';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
} from '../src/adapters/memory/index';

// Define test schema
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
});

type User = z.infer<typeof UserSchema>;

// Define model with primaryKeys
const UserModel = {
  schema: UserSchema,
  primaryKeys: ['id'] as const,
};

type UserMeta = MetaInput<typeof UserSchema>;
const userMeta: UserMeta = { model: UserModel };

// In-memory store
const createStore = () => {
  const users: User[] = [];
  return {
    users,
    clear: () => {
      users.length = 0;
    },
    add: (user: User) => {
      users.push(user);
      return user;
    },
    list: () => users,
  };
};

// Test middleware that tracks calls
const createTrackingMiddleware = (name: string, calls: string[]) => {
  const middleware: MiddlewareHandler = async (c, next) => {
    calls.push(`${name}:before`);
    await next();
    calls.push(`${name}:after`);
  };
  return middleware;
};

// Auth middleware that blocks requests without auth header
const createAuthMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
};

// Admin-only middleware
const createAdminMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const role = c.req.header('X-Role');
    if (role !== 'admin') {
      return c.json({ error: 'Forbidden - Admin only' }, 403);
    }
    await next();
  };
};

describe('Middleware Support', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('registerCrud with middleware', () => {
    it('should apply global middleware to all endpoints', async () => {
      const calls: string[] = [];
      const globalMiddleware = createTrackingMiddleware('global', calls);

      // Define endpoints
      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      class UserList extends MemoryListEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate, list: UserList }, {
        middlewares: [globalMiddleware],
      });

      // Test POST
      calls.length = 0;
      const createRes = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(createRes.status).toBe(201);
      expect(calls).toEqual(['global:before', 'global:after']);

      // Test GET
      calls.length = 0;
      const listRes = await app.request('/users');
      expect(listRes.status).toBe(200);
      expect(calls).toEqual(['global:before', 'global:after']);
    });

    it('should apply per-endpoint middleware', async () => {
      const calls: string[] = [];
      const createMiddleware = createTrackingMiddleware('create', calls);
      const listMiddleware = createTrackingMiddleware('list', calls);

      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      class UserList extends MemoryListEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate, list: UserList }, {
        endpointMiddlewares: {
          create: [createMiddleware],
          list: [listMiddleware],
        },
      });

      // Test POST
      calls.length = 0;
      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(calls).toEqual(['create:before', 'create:after']);

      // Test GET
      calls.length = 0;
      await app.request('/users');
      expect(calls).toEqual(['list:before', 'list:after']);
    });

    it('should execute middleware in correct order: global -> endpoint -> class', async () => {
      const calls: string[] = [];
      const globalMiddleware = createTrackingMiddleware('global', calls);
      const endpointMiddleware = createTrackingMiddleware('endpoint', calls);
      const classMiddleware = createTrackingMiddleware('class', calls);

      // Use builder to add class-level middleware
      const UserCreate = crud(userMeta)
        .create()
        .middleware(classMiddleware)
        .build(
          class extends MemoryCreateEndpoint<typeof userMeta> {
            _meta = userMeta;
            getStore = () => store.users;
            generateId = () => `user-${Date.now()}`;
          }
        );

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate }, {
        middlewares: [globalMiddleware],
        endpointMiddlewares: {
          create: [endpointMiddleware],
        },
      });

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      // Order: global -> endpoint -> class
      expect(calls).toEqual([
        'global:before',
        'endpoint:before',
        'class:before',
        'class:after',
        'endpoint:after',
        'global:after',
      ]);
    });

    it('should allow middleware to block requests', async () => {
      const authMiddleware = createAuthMiddleware();

      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate }, {
        middlewares: [authMiddleware],
      });

      // Without auth header - should be blocked
      const res1 = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(res1.status).toBe(401);
      const data1 = await res1.json();
      expect(data1.error).toBe('Unauthorized');

      // With auth header - should succeed
      const res2 = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token',
        },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(res2.status).toBe(201);
    });

    it('should support different middleware per endpoint type', async () => {
      const authMiddleware = createAuthMiddleware();
      const adminMiddleware = createAdminMiddleware();

      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      class UserList extends MemoryListEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate, list: UserList }, {
        middlewares: [authMiddleware], // All endpoints require auth
        endpointMiddlewares: {
          create: [adminMiddleware], // Create also requires admin
        },
      });

      // List with auth but no admin - should succeed
      const listRes = await app.request('/users', {
        headers: { 'Authorization': 'Bearer token' },
      });
      expect(listRes.status).toBe(200);

      // Create with auth but no admin - should fail
      const createRes1 = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token',
        },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(createRes1.status).toBe(403);

      // Create with auth and admin - should succeed
      const createRes2 = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token',
          'X-Role': 'admin',
        },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(createRes2.status).toBe(201);
    });
  });

  describe('Builder API with middleware', () => {
    it('should support .middleware() method on CreateBuilder', async () => {
      const calls: string[] = [];
      const middleware = createTrackingMiddleware('builder', calls);

      const UserCreate = crud(userMeta)
        .create()
        .tags('Users')
        .summary('Create user')
        .middleware(middleware)
        .build(
          class extends MemoryCreateEndpoint<typeof userMeta> {
            _meta = userMeta;
            getStore = () => store.users;
            generateId = () => `user-${Date.now()}`;
          }
        );

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate });

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      expect(calls).toEqual(['builder:before', 'builder:after']);
    });

    it('should support .middleware() method on ListBuilder', async () => {
      const calls: string[] = [];
      const middleware = createTrackingMiddleware('builder', calls);

      const UserList = crud(userMeta)
        .list()
        .tags('Users')
        .middleware(middleware)
        .build(
          class extends MemoryListEndpoint<typeof userMeta> {
            _meta = userMeta;
            getStore = () => store.users;
          }
        );

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { list: UserList });

      await app.request('/users');

      expect(calls).toEqual(['builder:before', 'builder:after']);
    });

    it('should support chaining multiple middleware in builder', async () => {
      const calls: string[] = [];
      const mw1 = createTrackingMiddleware('mw1', calls);
      const mw2 = createTrackingMiddleware('mw2', calls);

      const UserCreate = crud(userMeta)
        .create()
        .middleware(mw1, mw2)
        .build(
          class extends MemoryCreateEndpoint<typeof userMeta> {
            _meta = userMeta;
            getStore = () => store.users;
            generateId = () => `user-${Date.now()}`;
          }
        );

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate });

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      expect(calls).toEqual(['mw1:before', 'mw2:before', 'mw2:after', 'mw1:after']);
    });
  });

  describe('Functional API with middleware', () => {
    it('should support middlewares in createCreate config', async () => {
      const calls: string[] = [];
      const middleware = createTrackingMiddleware('functional', calls);

      const UserCreate = createCreate({
        meta: userMeta,
        middlewares: [middleware],
      }, class extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      });

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate });

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      expect(calls).toEqual(['functional:before', 'functional:after']);
    });

    it('should support middlewares in createList config', async () => {
      const calls: string[] = [];
      const middleware = createTrackingMiddleware('functional', calls);

      const UserList = createList({
        meta: userMeta,
        middlewares: [middleware],
      }, class extends MemoryListEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
      });

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { list: UserList });

      await app.request('/users');

      expect(calls).toEqual(['functional:before', 'functional:after']);
    });
  });

  describe('fromHono proxy with middleware', () => {
    it('should support middleware arguments in route methods', async () => {
      const calls: string[] = [];
      const middleware = createTrackingMiddleware('proxy', calls);

      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      const app = fromHono(new OpenAPIHono());
      app.post('/users', middleware, UserCreate);

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      expect(calls).toEqual(['proxy:before', 'proxy:after']);
    });

    it('should support multiple middleware arguments', async () => {
      const calls: string[] = [];
      const mw1 = createTrackingMiddleware('mw1', calls);
      const mw2 = createTrackingMiddleware('mw2', calls);

      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      const app = fromHono(new OpenAPIHono());
      app.post('/users', mw1, mw2, UserCreate);

      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });

      expect(calls).toEqual(['mw1:before', 'mw2:before', 'mw2:after', 'mw1:after']);
    });
  });

  describe('Backwards compatibility', () => {
    it('should work without middleware options', async () => {
      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(res.status).toBe(201);
    });

    it('should work with empty middleware arrays', async () => {
      class UserCreate extends MemoryCreateEndpoint<typeof userMeta> {
        _meta = userMeta;
        getStore = () => store.users;
        generateId = () => `user-${Date.now()}`;
      }

      const app = fromHono(new OpenAPIHono());
      registerCrud(app, '/users', { create: UserCreate }, {
        middlewares: [],
        endpointMiddlewares: {},
      });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', role: 'user' }),
      });
      expect(res.status).toBe(201);
    });
  });
});
