/**
 * Example: Basic CRUD Operations with Drizzle + PostgreSQL
 *
 * Demonstrates the fundamental CRUD operations:
 * - POST /users - Create a new user
 * - GET /users - List all users
 * - GET /users/:id - Get a user by ID
 * - PATCH /users/:id - Update a user
 * - DELETE /users/:id - Delete a user
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/basic-crud.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import { UserSchema, type User } from '../shared/schemas.js';
import { users } from './schema.js';
import { db, initDb } from './db.js';

// Cast db to DrizzleDatabase for type safety
const typedDb = db as unknown as DrizzleDatabase;

// Define the User model
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Endpoint Definitions
// ============================================================================

class UserCreate extends DrizzleCreateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Create a new user',
    description: 'Creates a new user with the provided data. ID is auto-generated if not provided.',
  };
}

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Returns a paginated list of users with optional filtering, searching, and sorting.',
  };

  // Configure filtering
  filterFields = ['role', 'status'];
  filterConfig = {
    age: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
  };

  // Configure search
  searchFields = ['name', 'email'];

  // Configure sorting
  orderByFields = ['name', 'createdAt', 'age'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';

  // Pagination defaults
  defaultPerPage = 20;
  maxPerPage = 100;
}

class UserRead extends DrizzleReadEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Returns a single user by their unique identifier.',
  };
}

class UserUpdate extends DrizzleUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
    description: 'Updates an existing user. Only provided fields are updated.',
  };

  // Control which fields can be updated
  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends DrizzleDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user',
    description: 'Permanently deletes a user by their ID.',
  };
}

// ============================================================================
// App Setup
// ============================================================================

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
    title: 'Basic CRUD Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates basic CRUD operations with hono-crud using Drizzle ORM and PostgreSQL.',
  },
});

// Swagger UI
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'drizzle', database: 'postgresql' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Basic CRUD Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs
OpenAPI spec at http://localhost:${port}/openapi.json

Available endpoints:
  POST   /users          - Create a user
  GET    /users          - List users (with filtering, search, pagination)
  GET    /users/:id      - Get a user by ID
  PATCH  /users/:id      - Update a user
  DELETE /users/:id      - Delete a user

Query parameters for list:
  ?role=admin            - Filter by role
  ?status=active         - Filter by status
  ?age[gte]=18           - Age >= 18
  ?age[between]=18,30    - Age between 18 and 30
  ?search=john           - Search by name or email
  ?order_by=name         - Sort by name
  ?order_by_direction=asc
  ?page=1&per_page=20    - Pagination

Try:
  curl -X POST http://localhost:${port}/users \\
    -H "Content-Type: application/json" \\
    -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
