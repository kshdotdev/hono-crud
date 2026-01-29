/**
 * Example: Soft Delete functionality
 *
 * Demonstrates how soft delete works:
 * - Records are not actually deleted, just marked with a timestamp
 * - Deleted records are hidden by default
 * - Use ?withDeleted=true to include deleted records
 * - Use ?onlyDeleted=true to show only deleted records
 *
 * Run with: npx tsx examples/soft-delete.ts
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
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// Define the User schema with deletedAt field for soft delete
const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
  createdAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(), // Soft delete field
});

type User = z.infer<typeof UserSchema>;

// Define the User model with soft delete enabled
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  // Enable soft delete - records will be marked with deletedAt instead of removed
  softDelete: true,
  // Or with custom configuration:
  // softDelete: {
  //   field: 'deletedAt',      // Default: 'deletedAt'
  //   allowQueryDeleted: true, // Default: true
  //   queryParam: 'withDeleted', // Default: 'withDeleted'
  // },
});

const userMeta = defineMeta({
  model: UserModel,
});

// Create endpoints
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Create a new user',
  };

  async before(data: Partial<User>) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
      deletedAt: null, // Ensure new records are not deleted
    } as User;
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'List all users',
    description: 'By default excludes deleted users. Use ?withDeleted=true to include them, or ?onlyDeleted=true to show only deleted users.',
  };

  filterFields = ['role'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Returns 404 if the user is soft-deleted.',
  };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Update a user',
    description: 'Cannot update soft-deleted users (returns 404).',
  };

  allowedUpdateFields = ['name', 'role'];
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Delete a user (soft delete)',
    description: 'Sets deletedAt timestamp instead of removing the record. Cannot delete already-deleted users.',
  };
}

class UserRestore extends MemoryRestoreEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'Restore a deleted user',
    description: 'Sets deletedAt back to null, making the user visible again. Only works on soft-deleted users.',
  };
}

// Create the app
const app = fromHono(new Hono());

// Register CRUD endpoints (including restore for soft delete)
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
  restore: UserRestore,
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Soft Delete Example API',
    version: '1.0.0',
    description: 'Demonstrates soft delete functionality',
  },
});

// Swagger UI
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Start server
const port = Number(process.env.PORT) || 3456;
console.log(`
=== Soft Delete Example ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

Try these commands:

1. Create users:
   curl -X POST http://localhost:${port}/users -H "Content-Type: application/json" -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'
   curl -X POST http://localhost:${port}/users -H "Content-Type: application/json" -d '{"email":"bob@example.com","name":"Bob","role":"user"}'

2. List users (shows both):
   curl http://localhost:${port}/users

3. Delete Alice (soft delete):
   curl -X DELETE http://localhost:${port}/users/<alice-id>

4. List users (Alice is hidden):
   curl http://localhost:${port}/users

5. List with deleted users:
   curl "http://localhost:${port}/users?withDeleted=true"

6. List only deleted users:
   curl "http://localhost:${port}/users?onlyDeleted=true"

7. Try to get deleted user (returns 404):
   curl http://localhost:${port}/users/<alice-id>

8. Try to update deleted user (returns 404):
   curl -X PATCH http://localhost:${port}/users/<alice-id> -H "Content-Type: application/json" -d '{"name":"Alice Updated"}'

9. RESTORE Alice (un-delete):
   curl -X POST http://localhost:${port}/users/<alice-id>/restore

10. List users (Alice is back!):
    curl http://localhost:${port}/users
`);

serve({
  fetch: app.fetch,
  port,
});
