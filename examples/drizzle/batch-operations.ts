/**
 * Example: Batch Operations with Drizzle + PostgreSQL
 *
 * Demonstrates batch CRUD operations:
 * - POST /users/batch - Create multiple users at once
 * - PATCH /users/batch - Update multiple users at once
 * - DELETE /users/batch - Delete multiple users at once
 * - POST /users/batch/restore - Restore multiple soft-deleted users
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/batch-operations.ts
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
  DrizzleBatchCreateEndpoint,
  DrizzleBatchUpdateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import { UserSchema, type User } from '../shared/schemas.js';
import { users } from './schema.js';
import { db, initDb, pool } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// User Model with Soft Delete for Batch Restore
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
  softDelete: true,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Standard CRUD Endpoints
// ============================================================================

class UserCreate extends DrizzleCreateEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
}

class UserRead extends DrizzleReadEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Get a user' };
}

class UserUpdate extends DrizzleUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserDelete extends DrizzleDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Delete a user (soft delete)' };
}

class UserRestore extends DrizzleRestoreEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

// ============================================================================
// Batch Endpoints
// ============================================================================

class UserBatchCreate extends DrizzleBatchCreateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Create multiple users',
    description: 'Creates up to 100 users in a single request.',
  };

  maxBatchSize = 100;
}

class UserBatchUpdate extends DrizzleBatchUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Update multiple users',
    description: 'Updates up to 100 users in a single request. Soft-deleted users cannot be updated.',
  };

  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];

  // Continue processing if one item fails
  stopOnError = false;
}

class UserBatchDelete extends DrizzleBatchDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Delete multiple users (soft delete)',
    description: 'Soft-deletes up to 100 users in a single request.',
  };

  maxBatchSize = 100;
  stopOnError = false;
}

class UserBatchRestore extends DrizzleBatchRestoreEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Restore multiple deleted users',
    description: 'Restores up to 100 soft-deleted users in a single request.',
  };

  maxBatchSize = 100;
  stopOnError = false;
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
  batchCreate: UserBatchCreate,
  batchUpdate: UserBatchUpdate,
  batchDelete: UserBatchDelete,
  batchRestore: UserBatchRestore,
});

// Clear data endpoint
app.get('/clear', async (c) => {
  await pool.query('TRUNCATE users CASCADE');
  return c.json({ success: true, message: 'Data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Batch Operations Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates batch create, update, delete, and restore operations.',
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
=== Batch Operations Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, clear any existing data:
  curl http://localhost:${port}/clear

1. BATCH CREATE - Create multiple users at once:
   curl -X POST http://localhost:${port}/users/batch \\
     -H "Content-Type: application/json" \\
     -d '{
       "items": [
         {"email": "alice@example.com", "name": "Alice", "role": "admin"},
         {"email": "bob@example.com", "name": "Bob", "role": "user"},
         {"email": "charlie@example.com", "name": "Charlie", "role": "user"},
         {"email": "diana@example.com", "name": "Diana", "role": "guest"}
       ]
     }'

2. List users to see the created records:
   curl http://localhost:${port}/users

3. BATCH UPDATE - Update multiple users (replace IDs with actual ones):
   curl -X PATCH http://localhost:${port}/users/batch \\
     -H "Content-Type: application/json" \\
     -d '{
       "items": [
         {"id": "<id1>", "data": {"role": "user", "status": "inactive"}},
         {"id": "<id2>", "data": {"name": "Robert", "status": "inactive"}}
       ]
     }'

4. BATCH DELETE - Soft-delete multiple users:
   curl -X DELETE http://localhost:${port}/users/batch \\
     -H "Content-Type: application/json" \\
     -d '{"ids": ["<id1>", "<id2>"]}'

5. List users (deleted users are hidden):
   curl http://localhost:${port}/users

6. List only deleted users:
   curl "http://localhost:${port}/users?onlyDeleted=true"

7. BATCH RESTORE - Restore multiple soft-deleted users:
   curl -X POST http://localhost:${port}/users/batch/restore \\
     -H "Content-Type: application/json" \\
     -d '{"ids": ["<id1>", "<id2>"]}'

8. List users again (restored users are back):
   curl http://localhost:${port}/users

Response Codes:
- 200/201: All operations succeeded
- 207: Partial success (some items succeeded, some failed)
- 400: Validation error (e.g., too many items)
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
