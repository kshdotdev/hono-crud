/**
 * Example: Soft Delete & Restore with Prisma + PostgreSQL
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
 * 2. npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. npx prisma db push --schema=examples/prisma/schema.prisma
 * 4. npx tsx examples/prisma/soft-delete.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
  PrismaRestoreEndpoint,
} from '../../src/adapters/prisma/index.js';
import { UserSchema, type User } from '../shared/schemas.js';
import { prisma, initDb } from './db.js';

// ============================================================================
// User Model with Soft Delete Enabled
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  // Enable soft delete
  softDelete: true,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Endpoint Definitions
// ============================================================================

class UserCreate extends PrismaCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'Create a new user',
  };
}

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prisma;

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

class UserRead extends PrismaReadEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Returns 404 if the user is soft-deleted.',
  };
}

class UserUpdate extends PrismaUpdateEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
    description: 'Cannot update soft-deleted users (returns 404).',
  };

  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends PrismaDeleteEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user (soft delete)',
    description: 'Sets deletedAt timestamp instead of removing the record.',
  };
}

class UserRestore extends PrismaRestoreEndpoint {
  _meta = userMeta;
  prisma = prisma;

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
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();

  const createdUsers = await Promise.all([
    prisma.user.create({ data: { name: 'Alice', email: 'alice@example.com', role: 'admin', status: 'active' } }),
    prisma.user.create({ data: { name: 'Bob', email: 'bob@example.com', role: 'user', status: 'active' } }),
    prisma.user.create({ data: { name: 'Charlie', email: 'charlie@example.com', role: 'user', status: 'active' } }),
  ]);

  return c.json({
    success: true,
    message: 'Seeded 3 users',
    users: createdUsers.map((u) => ({ id: u.id, name: u.name })),
  });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Soft Delete Example - Prisma + PostgreSQL',
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
=== Soft Delete Example (Prisma + PostgreSQL) ===

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
