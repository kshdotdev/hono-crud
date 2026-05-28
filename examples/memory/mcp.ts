/**
 * Example: Exposing CRUD resources as MCP tools (Memory Adapter)
 *
 * Mounts a normal hono-crud REST API and, on top of it, an MCP endpoint at
 * `/mcp` that auto-generates Model Context Protocol tools for each resource:
 *   - users_list, users_read, users_create, users_update, users_delete
 *
 * Tool calls are re-dispatched through the same Hono app, so they share the
 * exact REST pipeline (auth, validation, hooks, serialization, pagination).
 *
 * Run with: npx tsx examples/memory/mcp.ts
 */

import { createCrudMcp } from '@hono-crud/mcp';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { z } from 'zod';

clearStorage();

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  serializer: (user) => user,
});

const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
}
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  filterFields = ['role'];
  searchFields = ['name', 'email'];
}
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
}
class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  allowedUpdateFields = ['name', 'role'];
}
class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
}

const userEndpoints = {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
};

export const app = fromHono(new Hono());

// 1. Register the REST API as usual.
registerCrud(app, '/users', userEndpoints);

// 2. Expose those resources as MCP tools.
//    `auto: true` discovers every registerCrud(...) resource — no per-resource
//    wiring — and `resources` lets you override individual ones. (You can still
//    call mcp.resource(path, endpoints, ...) explicitly for finer control.)
const mcp = createCrudMcp(app, {
  name: 'user-management',
  version: '1.0.0',
  instructions: 'Tools to manage user accounts. Prefer users_list before mutating.',
  // Simple bearer-token gate; the same token is forwarded to the CRUD routes.
  auth: {
    strategy: 'verifier',
    verifyToken: (token) => (token === 'demo-token' ? { sub: 'demo-user' } : null),
  },
  auto: {
    resources: {
      '/users': {
        description: 'User accounts.',
        tools: {
          // Disable destructive deletes over MCP for this demo.
          delete: { enabled: false },
          list: { description: 'Search users by name/email or filter by role.' },
        },
      },
    },
  },
});

app.all('/mcp', mcp.handler());

app.get('/health', (c) => c.json({ status: 'ok', adapter: 'memory' }));

export function start(port: number = Number(process.env.PORT) || 3460): void {
  console.log(`
=== MCP Example (Memory Adapter) ===

Server running at http://localhost:${port}

  REST:  GET/POST/PATCH/DELETE http://localhost:${port}/users
  MCP:   POST http://localhost:${port}/mcp   (Authorization: Bearer demo-token)

Generated tools: users_list, users_read, users_create, users_update
`);

  serve({ fetch: app.fetch, port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
