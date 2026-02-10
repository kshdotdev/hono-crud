/**
 * Example: Basic CRUD Operations with Memory Adapter
 *
 * Demonstrates the fundamental CRUD operations:
 * - POST /users - Create a new user
 * - GET /users - List all users
 * - GET /users/:id - Get a user by ID
 * - PATCH /users/:id - Update a user
 * - DELETE /users/:id - Delete a user
 *
 * Run with: npx tsx examples/memory/basic-crud.ts
 */

import { Hono, type Env } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { fromHono, registerCrud, setupSwaggerUI, setupReDoc, setupScalar, defineModel, defineMeta } from '../../src/index.js';
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

// Define the User schema
const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
  createdAt: z.string().datetime().optional(),
});

type User = z.infer<typeof UserSchema>;

// Define the User model using the type-safe helper
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  serializer: (user) => {
    // Remove sensitive fields if needed
    return user;
  },
});

// Meta configuration using the type-safe helper
const userMeta = defineMeta({
  model: UserModel,
});

// Create endpoints - TypeScript infers the types from _meta
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Create a new user',
  };

  async before(data: Partial<User>) {
    // Add timestamps
    return {
      ...data,
      createdAt: new Date().toISOString(),
    } as User;
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'List all users',
  };

  // Configure filtering
  filterFields = ['role'];
  searchFields = ['name', 'email'];
  sortFields = ['name', 'createdAt'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
  };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
  };

  // Control which fields can be updated
  allowedUpdateFields = ['name', 'role'];
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user',
  };
}

// Create the app
const app = fromHono(new Hono());

// Register CRUD endpoints
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Basic CRUD Example - Memory Adapter',
    version: '1.0.0',
    description: 'A simple user management API using in-memory storage',
  },
});

// API Documentation UIs
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
setupReDoc(app, { redocPath: '/redoc', specPath: '/openapi.json', title: 'User API' });
setupScalar(app, '/reference', { specUrl: '/openapi.json', theme: 'default' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'memory' }));

// Start server
const port = Number(process.env.PORT) || 3456;
console.log(`
=== Basic CRUD Example (Memory Adapter) ===

Server running at http://localhost:${port}

Documentation:
  Swagger UI:     http://localhost:${port}/docs
  ReDoc:          http://localhost:${port}/redoc
  Scalar:         http://localhost:${port}/reference
  OpenAPI JSON:   http://localhost:${port}/openapi.json

Available endpoints:
  POST   /users          - Create a user
  GET    /users          - List users
  GET    /users/:id      - Get a user by ID
  PATCH  /users/:id      - Update a user
  DELETE /users/:id      - Delete a user

Try:
  curl -X POST http://localhost:${port}/users \\
    -H "Content-Type: application/json" \\
    -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'
`);

serve({
  fetch: app.fetch,
  port,
});
