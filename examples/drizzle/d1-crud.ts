/**
 * Example: Drizzle + Cloudflare D1 CRUD on Workers
 *
 * Demonstrates hono-crud running on Cloudflare Workers with D1 (SQLite) and a
 * KV-backed response cache.
 *
 * Endpoints:
 * - POST /tasks - Create a task
 * - GET /tasks - List tasks (filter, search, paginate; cached in KV)
 * - GET /tasks/:id - Get a task by ID
 * - PATCH /tasks/:id - Update a task
 * - DELETE /tasks/:id - Delete a task
 *
 * Setup:
 * 1. Create a D1 database: wrangler d1 create hono-crud-demo
 * 2. Add the bindings to wrangler.toml:
 *      [[d1_databases]]
 *      binding = "DB"
 *      database_name = "hono-crud-demo"
 *      database_id = "<your-database-id>"
 *      [[kv_namespaces]]
 *      binding = "CACHE_KV"
 *      id = "<your-kv-namespace-id>"
 * 3. Run migrations: wrangler d1 execute hono-crud-demo --file=./schema.sql
 * 4. Deploy: wrangler deploy
 *
 * Workers/D1 notes:
 * - Bindings only exist per request: create the Drizzle instance from
 *   `c.env.DB` in middleware and inject it with `c.set('db', db)`; the
 *   endpoints resolve it from the context (never a module-level singleton).
 * - Build the app with `new OpenAPIHono<Env>()`. `fromHono` cannot adopt a
 *   plain `Hono`, so middleware registered on one would be lost.
 * - No `gen_random_uuid()` — generate ids with `crypto.randomUUID()`.
 * - No interactive transactions: keep `useTransaction` at its default
 *   (`false`) and use `db.batch([...])` for multi-statement atomic writes.
 * - `ilike` works on SQLite (implemented with `INSTR(LOWER(...))`); note that
 *   SQLite's `LOWER()` only folds ASCII characters.
 * - Max 5 MB per query response / 100k rows; ~100 bound parameters per query.
 */

import { KVCacheStorage } from '@hono-crud/cache';
import { type DrizzleDatabaseConstraint, createDrizzleCrud } from '@hono-crud/drizzle';
import { swaggerUI } from '@hono-crud/swagger';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { type StorageEnv, createStorageMiddleware } from 'hono-crud/storage';
import { z } from 'zod';

// ============================================================================
// D1 Schema (SQLite via Drizzle)
// ============================================================================

/**
 * SQL to create this table (run with `wrangler d1 execute`):
 *
 * CREATE TABLE IF NOT EXISTS tasks (
 *   id TEXT PRIMARY KEY,
 *   title TEXT NOT NULL,
 *   description TEXT,
 *   status TEXT NOT NULL DEFAULT 'todo',
 *   priority INTEGER NOT NULL DEFAULT 0,
 *   created_at TEXT NOT NULL DEFAULT (datetime('now')),
 *   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
 * );
 */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', { enum: ['todo', 'in_progress', 'done'] })
    .notNull()
    .default('todo'),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ============================================================================
// Zod Schema & Model
// ============================================================================

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  priority: z.number().int().min(0).max(5).default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const TaskModel = defineModel({
  tableName: 'tasks',
  schema: TaskSchema,
  primaryKeys: ['id'],
  table: tasks,
});

const taskMeta = defineMeta({ model: TaskModel });
type Task = z.infer<typeof TaskSchema>;

// ============================================================================
// Cloudflare Workers Bindings
// ============================================================================

type Bindings = {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
};

type Env = StorageEnv & { Bindings: Bindings };

// ============================================================================
// Endpoint Definitions
// ============================================================================

/**
 * Create endpoints using the factory pattern. No database is passed here:
 * the per-request middleware below injects it into the context, and the
 * Drizzle endpoints resolve it from there.
 */
const TaskCrud = createDrizzleCrud<typeof taskMeta, Env>(
  undefined as unknown as DrizzleDatabaseConstraint,
  taskMeta,
);

class TaskCreate extends TaskCrud.Create {
  schema = {
    tags: ['Tasks'],
    summary: 'Create a task',
  };

  /**
   * Generate UUID and timestamps since D1/SQLite lacks gen_random_uuid().
   */
  async before(data: Task): Promise<Task> {
    const now = new Date().toISOString();
    return {
      ...data,
      id: data.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  }
}

class TaskList extends TaskCrud.List {
  schema = {
    tags: ['Tasks'],
    summary: 'List tasks',
  };

  filterFields = ['status'];
  filterConfig = {
    priority: ['eq', 'gt', 'gte', 'lt', 'lte'] as const,
  };

  searchFields = ['title', 'description'];
  sortFields = ['createdAt', 'priority', 'title'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };

  defaultPerPage = 20;
  maxPerPage = 100;

  // Cache list responses in KV (the mutation verbs invalidate the table's
  // entries automatically). KV floors TTLs at 60 seconds.
  protected override cacheEnabled = true;
  protected override cacheTtlSeconds = 60;
}

class TaskRead extends TaskCrud.Read {
  schema = {
    tags: ['Tasks'],
    summary: 'Get a task by ID',
  };
}

class TaskUpdate extends TaskCrud.Update {
  schema = {
    tags: ['Tasks'],
    summary: 'Update a task',
  };

  allowedUpdateFields = ['title', 'description', 'status', 'priority'];

  async before(data: Partial<Task>): Promise<Partial<Task>> {
    return {
      ...data,
      updatedAt: new Date().toISOString(),
    };
  }
}

class TaskDelete extends TaskCrud.Delete {
  schema = {
    tags: ['Tasks'],
    summary: 'Delete a task',
  };
}

// ============================================================================
// App Setup
// ============================================================================

// Must be an OpenAPIHono: middleware registered here survives `fromHono`.
const app = new OpenAPIHono<Env>();

/**
 * Per-request middleware: create Drizzle instance from D1 binding
 * and inject storage into context.
 */
app.use('*', async (c, next) => {
  // Create Drizzle DB from the D1 binding (per-request, not module-level)
  const db = drizzle(c.env.DB);

  // Store db in context so endpoints can access it
  c.set('db' as never, db as never);

  // Optional: inject KV-backed cache if binding exists. createStorageMiddleware
  // writes the `cacheStorage` context var that the cached endpoints read.
  if (c.env.CACHE_KV) {
    const cache = new KVCacheStorage({ kv: c.env.CACHE_KV });
    return createStorageMiddleware<Env>({ cacheStorage: cache })(c, next);
  }

  await next();
});

// Wrap with OpenAPI handler
export const openApiApp = fromHono(app);

// Register CRUD endpoints
registerCrud(openApiApp, '/tasks', {
  create: TaskCreate,
  list: TaskList,
  read: TaskRead,
  update: TaskUpdate,
  delete: TaskDelete,
});

// OpenAPI documentation
openApiApp.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Tasks API — Drizzle + Cloudflare D1',
    version: '1.0.0',
    description: 'CRUD API running on Cloudflare Workers with D1 (SQLite) via hono-crud.',
  },
});

// Swagger UI
openApiApp.get('/docs', swaggerUI({ specUrl: '/openapi.json' }));

// Health check
openApiApp.get('/health', (c) => c.json({ status: 'ok', adapter: 'drizzle', database: 'd1' }));

// ============================================================================
// Worker Export
// ============================================================================

export default {
  fetch: openApiApp.fetch,
};
