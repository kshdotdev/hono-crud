/**
 * Example: Drizzle + Cloudflare D1 CRUD on Workers
 *
 * Demonstrates hono-crud running on Cloudflare Workers with D1 (SQLite).
 *
 * Endpoints:
 * - POST /tasks - Create a task
 * - GET /tasks - List tasks (filter, search, paginate)
 * - GET /tasks/:id - Get a task by ID
 * - PATCH /tasks/:id - Update a task
 * - DELETE /tasks/:id - Delete a task
 *
 * Setup:
 * 1. Create a D1 database: wrangler d1 create hono-crud-demo
 * 2. Add the binding to wrangler.toml:
 *      [[d1_databases]]
 *      binding = "DB"
 *      database_name = "hono-crud-demo"
 *      database_id = "<your-database-id>"
 * 3. Run migrations: wrangler d1 execute hono-crud-demo --file=./schema.sql
 * 4. Deploy: wrangler deploy
 *
 * D1 Caveats:
 * - No `gen_random_uuid()` — use `crypto.randomUUID()` in application code
 * - The `ilike` filter operator is unsupported on SQLite — use `like` instead
 *   (SQLite `LIKE` is case-insensitive for ASCII by default)
 * - Max 5 MB per query response / 100k rows
 * - No nested transactions or savepoints
 * - `db` must be created per-request from `c.env.DB` (not a module-level singleton)
 */

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  fromHono,
  registerCrud,
  defineModel,
  defineMeta,
  createCrudMiddleware,
  KVCacheStorage,
  setupSwaggerUI,
} from '../../src/index.js';
import {
  createDrizzleCrud,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';

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
  status: text('status', { enum: ['todo', 'in_progress', 'done'] }).notNull().default('todo'),
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

type Env = { Bindings: Bindings };

// ============================================================================
// Endpoint Definitions
// ============================================================================

/**
 * Create endpoints using the factory pattern.
 * The `db` is set per-request in the middleware below,
 * so we use a placeholder here and override in `before()`.
 */

const TaskCrud = createDrizzleCrud<typeof taskMeta, Env>(
  undefined as unknown as DrizzleDatabase,
  taskMeta
);

class TaskCreate extends TaskCrud.Create {
  schema = {
    tags: ['Tasks'],
    summary: 'Create a task',
  };

  protected override getDb(): DrizzleDatabase {
    return drizzle(this.getContext().env.DB) as unknown as DrizzleDatabase;
  }

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

  // Use `like` instead of `ilike` — SQLite LIKE is case-insensitive for ASCII
  filterFields = ['status'];
  filterConfig = {
    priority: ['eq', 'gt', 'gte', 'lt', 'lte'] as const,
  };

  searchFields = ['title', 'description'];
  orderByFields = ['createdAt', 'priority', 'title'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';

  defaultPerPage = 20;
  maxPerPage = 100;

  protected override getDb(): DrizzleDatabase {
    return drizzle(this.getContext().env.DB) as unknown as DrizzleDatabase;
  }
}

class TaskRead extends TaskCrud.Read {
  schema = {
    tags: ['Tasks'],
    summary: 'Get a task by ID',
  };

  protected override getDb(): DrizzleDatabase {
    return drizzle(this.getContext().env.DB) as unknown as DrizzleDatabase;
  }
}

class TaskUpdate extends TaskCrud.Update {
  schema = {
    tags: ['Tasks'],
    summary: 'Update a task',
  };

  allowedUpdateFields = ['title', 'description', 'status', 'priority'];

  protected override getDb(): DrizzleDatabase {
    return drizzle(this.getContext().env.DB) as unknown as DrizzleDatabase;
  }

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

  protected override getDb(): DrizzleDatabase {
    return drizzle(this.getContext().env.DB) as unknown as DrizzleDatabase;
  }
}

// ============================================================================
// App Setup
// ============================================================================

const app = new Hono<Env>();

/**
 * Per-request middleware: create Drizzle instance from D1 binding
 * and inject storage into context.
 */
app.use('*', async (c, next) => {
  // Create Drizzle DB from the D1 binding (per-request, not module-level)
  const db = drizzle(c.env.DB);

  // Store db in context so endpoints can access it
  c.set('db' as never, db);

  // Optional: inject KV-backed cache if binding exists
  if (c.env.CACHE_KV) {
    const cache = new KVCacheStorage({ kv: c.env.CACHE_KV });
    return createCrudMiddleware({ cache })(c as never, next);
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
setupSwaggerUI(openApiApp, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
openApiApp.get('/health', (c) =>
  c.json({ status: 'ok', adapter: 'drizzle', database: 'd1' })
);

// ============================================================================
// Worker Export
// ============================================================================

export default {
  fetch: openApiApp.fetch,
};
