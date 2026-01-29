/**
 * Example: Batch Operations functionality
 *
 * Demonstrates batch operations:
 * - POST /users/batch - Create multiple users at once
 * - PATCH /users/batch - Update multiple users at once
 * - DELETE /users/batch - Delete multiple users at once
 * - POST /users/batch/restore - Restore multiple soft-deleted users
 *
 * Run with: npx tsx examples/batch-operations.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryRestoreEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// Define the User schema with soft delete support
const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  status: z.enum(['active', 'inactive']).default('active'),
  createdAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(),
});

type User = z.infer<typeof UserSchema>;

// Define the User model with soft delete enabled
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  softDelete: true,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Standard CRUD Endpoints
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a user' };

  async before(data: Partial<User>) {
    return { ...data, createdAt: new Date().toISOString(), deletedAt: null };
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get a user' };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Delete a user (soft delete)' };
}

class UserRestore extends MemoryRestoreEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

// ============================================================================
// Batch Endpoints
// ============================================================================

class UserBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Create multiple users',
    description: 'Creates up to 100 users in a single request.',
  };

  // Maximum 100 items per request (default)
  maxBatchSize = 100;

  async before(data: Partial<User>, index: number) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
  }
}

class UserBatchUpdate extends MemoryBatchUpdateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Update multiple users',
    description: 'Updates up to 100 users in a single request. Soft-deleted users cannot be updated.',
  };

  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];

  // Continue updating remaining items if one fails
  stopOnError = false;
}

class UserBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users - Batch'],
    summary: 'Delete multiple users (soft delete)',
    description: 'Soft-deletes up to 100 users in a single request.',
  };

  maxBatchSize = 100;
  stopOnError = false;
}

class UserBatchRestore extends MemoryBatchRestoreEndpoint {
  _meta = userMeta;

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

// Register all CRUD endpoints including batch operations
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

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Batch Operations Example API',
    version: '1.0.0',
    description: 'Demonstrates batch create, update, delete, and restore operations',
  },
});

// Swagger UI
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Start server
const port = Number(process.env.PORT) || 3456;
console.log(`
=== Batch Operations Example ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

Try these commands:

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

3. BATCH UPDATE - Update multiple users (replace <id1>, <id2> with actual IDs):
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
- 207: Partial success (some items succeeded, some failed or not found)
- 400: Validation error

Partial Success Example (207 response):
{
  "success": true,
  "result": {
    "updated": [...],  // Successfully updated items
    "count": 2,
    "notFound": ["non-existent-id"],  // IDs that weren't found
    "errors": [...]  // Any errors during processing
  }
}
`);

serve({
  fetch: app.fetch,
  port,
});
