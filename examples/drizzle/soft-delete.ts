/**
 * Example: Soft Delete & Restore with Drizzle + PostgreSQL
 *
 * Demonstrates soft delete functionality:
 * - Records are marked with deletedAt timestamp instead of being removed
 * - Deleted records are hidden by default in queries
 * - Use ?withDeleted=true to include deleted records
 * - Use ?onlyDeleted=true to show only deleted records
 * - POST /users/:id/restore to un-delete a record
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/soft-delete.ts
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
  DrizzleRestoreEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import { UserSchema, type User } from '../shared/schemas.js';
import { users } from './schema.js';
import { db, initDb, pool } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// User Model with Soft Delete Enabled
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
  // Enable soft delete
  softDelete: true,
  // Or with custom configuration:
  // softDelete: {
  //   field: 'deletedAt',           // Column name (default: 'deletedAt')
  //   allowQueryDeleted: true,      // Allow ?withDeleted and ?onlyDeleted (default: true)
  //   queryParam: 'withDeleted',    // Query param name (default: 'withDeleted')
  // },
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
  };
}

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'List users',
    description: `
By default, excludes soft-deleted users.

Query parameters:
- \`?withDeleted=true\` - Include deleted users in results
- \`?onlyDeleted=true\` - Show only deleted users
    `,
  };

  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
}

class UserRead extends DrizzleReadEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Returns 404 if the user is soft-deleted.',
  };
}

class UserUpdate extends DrizzleUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
    description: 'Cannot update soft-deleted users (returns 404).',
  };

  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends DrizzleDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user (soft delete)',
    description: 'Sets deletedAt timestamp instead of removing the record.',
  };
}

class UserRestore extends DrizzleRestoreEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Restore a deleted user',
    description: 'Sets deletedAt back to null, making the user visible again.',
  };
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
  restore: UserRestore,
});

// Seed endpoint
app.get('/seed', async (c) => {
  await pool.query('TRUNCATE users CASCADE');

  const seedData = [
    { name: 'Alice', email: 'alice@example.com', role: 'admin', status: 'active' },
    { name: 'Bob', email: 'bob@example.com', role: 'user', status: 'active' },
    { name: 'Charlie', email: 'charlie@example.com', role: 'user', status: 'active' },
  ];

  for (const user of seedData) {
    await pool.query(
      'INSERT INTO users (email, name, role, status) VALUES ($1, $2, $3, $4)',
      [user.email, user.name, user.role, user.status]
    );
  }

  return c.json({ success: true, message: 'Seeded 3 users' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Soft Delete Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates soft delete and restore functionality.',
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Soft Delete Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, seed the test data:
  curl http://localhost:${port}/seed

Walkthrough:

1. List users (shows all 3):
   curl http://localhost:${port}/users

2. Get the first user's ID and delete them:
   curl -X DELETE http://localhost:${port}/users/<user-id>

3. List users (deleted user is hidden):
   curl http://localhost:${port}/users

4. List with deleted users included:
   curl "http://localhost:${port}/users?withDeleted=true"

5. List only deleted users:
   curl "http://localhost:${port}/users?onlyDeleted=true"

6. Try to get deleted user (returns 404):
   curl http://localhost:${port}/users/<user-id>

7. Try to update deleted user (returns 404):
   curl -X PATCH http://localhost:${port}/users/<user-id> \\
     -H "Content-Type: application/json" \\
     -d '{"name":"Updated Name"}'

8. Restore the deleted user:
   curl -X POST http://localhost:${port}/users/<user-id>/restore

9. List users (restored user is back):
   curl http://localhost:${port}/users

10. Verify restored user can be accessed:
    curl http://localhost:${port}/users/<user-id>
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
