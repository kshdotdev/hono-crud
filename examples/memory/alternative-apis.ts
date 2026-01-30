/**
 * Example: Alternative API Patterns
 *
 * Demonstrates all four ways to define CRUD endpoints:
 * 1. Class-based (existing approach)
 * 2. Function-based (factory functions)
 * 3. Builder/Fluent (chainable API)
 * 4. Config-based (declarative objects)
 *
 * All patterns produce classes compatible with `registerCrud()` and can be mixed.
 *
 * Run with: npx tsx examples/memory/alternative-apis.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import {
  fromHono,
  registerCrud,
  setupSwaggerUI,
  defineModel,
  defineMeta,
  // Function-based API
  createCreate,
  createList,
  createRead,
  createUpdate,
  createDelete,
  // Builder/Fluent API
  crud,
  // Config-based API
  defineEndpoints,
  MemoryAdapters,
} from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// ============================================================================
// Shared Schema and Meta
// ============================================================================

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  status: z.enum(['active', 'inactive']).default('active'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

type User = z.infer<typeof UserSchema>;

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Pattern 1: Class-based (Existing Approach)
// ============================================================================

class ClassUserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Class-based)'], summary: 'Create user (class)' };

  async before(data: Partial<User>) {
    return { ...data, createdAt: new Date().toISOString() } as User;
  }
}

class ClassUserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Class-based)'], summary: 'List users (class)' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
  defaultOrderDirection: 'asc' | 'desc' = 'desc';
}

class ClassUserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Class-based)'], summary: 'Get user (class)' };
}

class ClassUserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Class-based)'], summary: 'Update user (class)' };
  allowedUpdateFields = ['name', 'role', 'status'];

  async before(data: Partial<User>) {
    return { ...data, updatedAt: new Date().toISOString() };
  }
}

class ClassUserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Class-based)'], summary: 'Delete user (class)' };
}

// ============================================================================
// Pattern 2: Function-based (Factory Functions)
// ============================================================================

const FnUserCreate = createCreate(
  {
    meta: userMeta,
    schema: { tags: ['Users (Function-based)'], summary: 'Create user (function)' },
    before: (data) => ({ ...data, createdAt: new Date().toISOString() }) as User,
  },
  MemoryCreateEndpoint
);

const FnUserList = createList(
  {
    meta: userMeta,
    schema: { tags: ['Users (Function-based)'], summary: 'List users (function)' },
    filterFields: ['role', 'status'],
    searchFields: ['name', 'email'],
    orderByFields: ['name', 'createdAt'],
    defaultOrderDirection: 'desc',
  },
  MemoryListEndpoint
);

const FnUserRead = createRead(
  {
    meta: userMeta,
    schema: { tags: ['Users (Function-based)'], summary: 'Get user (function)' },
  },
  MemoryReadEndpoint
);

const FnUserUpdate = createUpdate(
  {
    meta: userMeta,
    schema: { tags: ['Users (Function-based)'], summary: 'Update user (function)' },
    allowedUpdateFields: ['name', 'role', 'status'],
    before: (data) => ({ ...data, updatedAt: new Date().toISOString() }),
  },
  MemoryUpdateEndpoint
);

const FnUserDelete = createDelete(
  {
    meta: userMeta,
    schema: { tags: ['Users (Function-based)'], summary: 'Delete user (function)' },
  },
  MemoryDeleteEndpoint
);

// ============================================================================
// Pattern 3: Builder/Fluent (Chainable API)
// ============================================================================

const BuilderUserCreate = crud(userMeta)
  .create()
  .tags('Users (Builder)')
  .summary('Create user (builder)')
  .before((data) => ({ ...data, createdAt: new Date().toISOString() }) as User)
  .build(MemoryCreateEndpoint);

const BuilderUserList = crud(userMeta)
  .list()
  .tags('Users (Builder)')
  .summary('List users (builder)')
  .filter('role', 'status')
  .search('name', 'email')
  .orderBy('name', 'createdAt')
  .defaultOrder('createdAt', 'desc')
  .pagination(20, 100)
  .build(MemoryListEndpoint);

const BuilderUserRead = crud(userMeta)
  .read()
  .tags('Users (Builder)')
  .summary('Get user (builder)')
  .build(MemoryReadEndpoint);

const BuilderUserUpdate = crud(userMeta)
  .update()
  .tags('Users (Builder)')
  .summary('Update user (builder)')
  .allowedFields('name', 'role', 'status')
  .before((data) => ({ ...data, updatedAt: new Date().toISOString() }))
  .build(MemoryUpdateEndpoint);

const BuilderUserDelete = crud(userMeta)
  .delete()
  .tags('Users (Builder)')
  .summary('Delete user (builder)')
  .build(MemoryDeleteEndpoint);

// ============================================================================
// Pattern 4: Config-based (Declarative Objects)
// ============================================================================

const configEndpoints = defineEndpoints(
  {
    meta: userMeta,

    create: {
      openapi: { tags: ['Users (Config-based)'], summary: 'Create user (config)' },
      hooks: {
        before: (data) => ({ ...data, createdAt: new Date().toISOString() }) as User,
      },
    },

    list: {
      openapi: { tags: ['Users (Config-based)'], summary: 'List users (config)' },
      filtering: { fields: ['role', 'status'] },
      search: { fields: ['name', 'email'] },
      sorting: {
        fields: ['name', 'createdAt'],
        default: 'createdAt',
        defaultDirection: 'desc',
      },
      pagination: { defaultPerPage: 20, maxPerPage: 100 },
    },

    read: {
      openapi: { tags: ['Users (Config-based)'], summary: 'Get user (config)' },
    },

    update: {
      openapi: { tags: ['Users (Config-based)'], summary: 'Update user (config)' },
      fields: { allowed: ['name', 'role', 'status'] },
      hooks: {
        before: (data) => ({ ...data, updatedAt: new Date().toISOString() }),
      },
    },

    delete: {
      openapi: { tags: ['Users (Config-based)'], summary: 'Delete user (config)' },
    },
  },
  MemoryAdapters
);

// ============================================================================
// Create App and Register All Patterns
// ============================================================================

const app = fromHono(new Hono());

// Pattern 1: Class-based
registerCrud(app, '/class/users', {
  create: ClassUserCreate,
  list: ClassUserList,
  read: ClassUserRead,
  update: ClassUserUpdate,
  delete: ClassUserDelete,
});

// Pattern 2: Function-based
registerCrud(app, '/function/users', {
  create: FnUserCreate,
  list: FnUserList,
  read: FnUserRead,
  update: FnUserUpdate,
  delete: FnUserDelete,
});

// Pattern 3: Builder/Fluent
registerCrud(app, '/builder/users', {
  create: BuilderUserCreate,
  list: BuilderUserList,
  read: BuilderUserRead,
  update: BuilderUserUpdate,
  delete: BuilderUserDelete,
});

// Pattern 4: Config-based
registerCrud(app, '/config/users', configEndpoints);

// ============================================================================
// Mixing Patterns Example
// ============================================================================

// You can mix different patterns in a single registration!
const MixedCreate = crud(userMeta)
  .create()
  .tags('Users (Mixed)')
  .summary('Create user (builder pattern)')
  .before((data) => ({ ...data, createdAt: new Date().toISOString() }) as User)
  .build(MemoryCreateEndpoint);

const MixedList = createList(
  {
    meta: userMeta,
    schema: { tags: ['Users (Mixed)'], summary: 'List users (function pattern)' },
    filterFields: ['role'],
    searchFields: ['name'],
  },
  MemoryListEndpoint
);

class MixedRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users (Mixed)'], summary: 'Get user (class pattern)' };
}

registerCrud(app, '/mixed/users', {
  create: MixedCreate,
  list: MixedList,
  read: MixedRead,
  // Other endpoints can be added using any pattern
});

// ============================================================================
// Documentation
// ============================================================================

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Alternative API Patterns Example',
    version: '1.0.0',
    description: `
Demonstrates all four ways to define CRUD endpoints:

1. **Class-based** (/class/users) - Traditional approach with class inheritance
2. **Function-based** (/function/users) - Factory functions for quick setup
3. **Builder/Fluent** (/builder/users) - Chainable API with .build() at the end
4. **Config-based** (/config/users) - Single declarative object
5. **Mixed** (/mixed/users) - Combining different patterns together

All patterns produce the same result and are fully compatible with registerCrud().
Choose the pattern that best fits your coding style and project requirements.
    `.trim(),
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;
console.log(`
=== Alternative API Patterns Example ===

Server running at http://localhost:${port}

Documentation: http://localhost:${port}/docs

Endpoints by pattern:

1. Class-based:
   POST   /class/users     - Create user
   GET    /class/users     - List users
   GET    /class/users/:id - Get user
   PATCH  /class/users/:id - Update user
   DELETE /class/users/:id - Delete user

2. Function-based:
   POST   /function/users     - Create user
   GET    /function/users     - List users
   GET    /function/users/:id - Get user
   PATCH  /function/users/:id - Update user
   DELETE /function/users/:id - Delete user

3. Builder/Fluent:
   POST   /builder/users     - Create user
   GET    /builder/users     - List users
   GET    /builder/users/:id - Get user
   PATCH  /builder/users/:id - Update user
   DELETE /builder/users/:id - Delete user

4. Config-based:
   POST   /config/users     - Create user
   GET    /config/users     - List users
   GET    /config/users/:id - Get user
   PATCH  /config/users/:id - Update user
   DELETE /config/users/:id - Delete user

5. Mixed patterns:
   POST   /mixed/users     - Create user (builder)
   GET    /mixed/users     - List users (function)
   GET    /mixed/users/:id - Get user (class)

Try creating a user:
  curl -X POST http://localhost:${port}/builder/users \\
    -H "Content-Type: application/json" \\
    -d '{"email":"test@example.com","name":"Test User","role":"user"}'
`);

serve({
  fetch: app.fetch,
  port,
});
