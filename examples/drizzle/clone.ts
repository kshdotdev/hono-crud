/**
 * Example: Drizzle clone endpoint over libsql in-memory SQLite.
 *
 * Self-contained — no docker, no external DB. Run with:
 *
 *   pnpm tsx examples/drizzle/clone.ts
 *
 * The script wires a single Articles resource with full CRUD plus the new
 * `DrizzleCloneEndpoint`, seeds two articles, then exercises six clone
 * scenarios end-to-end via `app.request(...)`. It exits 0 only when every
 * scenario passes; any mismatch throws and the script exits non-zero.
 *
 * Scenarios covered (each prints PASS/FAIL):
 *   1. Clone a basic record — fresh primary key, source data copied
 *   2. Clone with body overrides — overrides win over source data
 *   3. Clone via the strip-publishedAt endpoint — excludeFromClone wipes it
 *      and the body's value populates the new row
 *   4. Source not found → 404
 *   5. Soft-deleted source → 404 (must not be cloneable)
 *   6. Original record remains intact in the DB after clone
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { defineModel, defineMeta, registerCrud, fromHono } from '../../src/index.js';
import {
  DrizzleCloneEndpoint,
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';

// -----------------------------------------------------------------------------
// Schema + DB
// -----------------------------------------------------------------------------

const articlesTable = sqliteTable('articles', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('draft'),
  publishedAt: text('publishedAt'),
  deletedAt: text('deletedAt'),
});

const ArticleSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  publishedAt: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

const ArticleModel = defineModel({
  tableName: 'articles',
  schema: ArticleSchema,
  primaryKeys: ['id'],
  table: articlesTable,
  softDelete: { field: 'deletedAt' },
});

const articleMeta = defineMeta({ model: ArticleModel });

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const typedDb = db as unknown as DrizzleDatabase;

// -----------------------------------------------------------------------------
// Endpoint classes
// -----------------------------------------------------------------------------

class ArticleCreate extends DrizzleCreateEndpoint {
  _meta = articleMeta;
  db = typedDb;
}

class ArticleRead extends DrizzleReadEndpoint {
  _meta = articleMeta;
  db = typedDb;
}

class ArticleList extends DrizzleListEndpoint {
  _meta = articleMeta;
  db = typedDb;
}

class ArticleClone extends DrizzleCloneEndpoint {
  _meta = articleMeta;
  db = typedDb;
}

/** Variant: strips `publishedAt` so each clone starts unpublished by default. */
class ArticleCloneAsDraft extends DrizzleCloneEndpoint {
  _meta = articleMeta;
  db = typedDb;
  excludeFromClone = ['publishedAt', 'status'];
}

// -----------------------------------------------------------------------------
// App wiring
// -----------------------------------------------------------------------------

type EndpointInstance = {
  setContext(ctx: Context): void;
  handle(): Promise<Response>;
};

function withContext(EndpointClass: new () => EndpointInstance) {
  return async (c: Context) => {
    const endpoint = new EndpointClass();
    endpoint.setContext(c);
    return endpoint.handle();
  };
}

export function buildApp() {
  const openApi = new OpenAPIHono();
  openApi.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ success: false, error: { message: err.message } }, status as 400 | 404 | 500);
  });
  const app = fromHono(openApi);

  registerCrud(app, '/articles', {
    create: ArticleCreate,
    list: ArticleList,
    read: ArticleRead,
    clone: ArticleClone,
  });

  app.post('/articles/:id/clone-as-draft', withContext(ArticleCloneAsDraft));

  return app;
}

// -----------------------------------------------------------------------------
// Demo runner
// -----------------------------------------------------------------------------

async function setupSchema(): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      publishedAt TEXT,
      deletedAt TEXT
    )
  `);
  await db.run(sql`DELETE FROM articles`);
}

interface OkBody<T> {
  success: true;
  result: T;
}

interface ErrBody {
  success: false;
  error: { message: string };
}

type Article = z.infer<typeof ArticleSchema>;

function check(label: string, condition: boolean, detail?: string): void {
  if (!condition) {
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    throw new Error(`Scenario "${label}" failed`);
  }
  console.log(`  PASS: ${label}`);
}

async function runDemo(): Promise<void> {
  await setupSchema();
  const app = buildApp();

  // -------------------------------------------------------------------------
  // Seed
  // -------------------------------------------------------------------------
  console.log('\n[seed] inserting source articles');
  const sourceId = crypto.randomUUID();
  await db.insert(articlesTable).values({
    id: sourceId,
    title: 'On Composition',
    body: 'Reuse beats reinvention.',
    status: 'published',
    publishedAt: '2026-05-01T10:00:00.000Z',
  });

  // -------------------------------------------------------------------------
  // 1. Basic clone
  // -------------------------------------------------------------------------
  console.log('\n[1] clone with empty body — fresh PK, data copied');
  {
    const res = await app.request(`/articles/${sourceId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('status 201', res.status === 201, `got ${res.status}`);
    const body = (await res.json()) as OkBody<Article>;
    check('success flag', body.success === true);
    check('fresh primary key', body.result.id !== sourceId, `clone id ${body.result.id} === source ${sourceId}`);
    check('title copied', body.result.title === 'On Composition');
    check('body copied', body.result.body === 'Reuse beats reinvention.');
    check('publishedAt copied', body.result.publishedAt === '2026-05-01T10:00:00.000Z');
  }

  // -------------------------------------------------------------------------
  // 2. Body overrides
  // -------------------------------------------------------------------------
  console.log('\n[2] clone with body overrides — body wins');
  {
    const res = await app.request(`/articles/${sourceId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'On Composition (Translated)',
        status: 'draft',
      }),
    });
    check('status 201', res.status === 201, `got ${res.status}`);
    const body = (await res.json()) as OkBody<Article>;
    check('title overridden', body.result.title === 'On Composition (Translated)');
    check('status overridden', body.result.status === 'draft');
    check('body fallback to source', body.result.body === 'Reuse beats reinvention.');
  }

  // -------------------------------------------------------------------------
  // 3. excludeFromClone — strip publishedAt + status, body provides defaults
  // -------------------------------------------------------------------------
  console.log('\n[3] clone-as-draft — excludeFromClone strips publishedAt + status');
  {
    const res = await app.request(`/articles/${sourceId}/clone-as-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('status 201', res.status === 201, `got ${res.status}`);
    const body = (await res.json()) as OkBody<Article>;
    check('publishedAt stripped (null)', body.result.publishedAt === null || body.result.publishedAt === undefined);
    // status was excluded → falls back to schema default 'draft'
    check('status reset to draft', body.result.status === 'draft', `got ${body.result.status}`);
    check('title still copied', body.result.title === 'On Composition');
  }

  // -------------------------------------------------------------------------
  // 4. Source not found
  // -------------------------------------------------------------------------
  console.log('\n[4] clone unknown id → 404');
  {
    const res = await app.request(`/articles/${crypto.randomUUID()}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('status 404', res.status === 404, `got ${res.status}`);
    const body = (await res.json()) as ErrBody;
    check('error message mentions not found', /not found/i.test(body.error.message), body.error.message);
  }

  // -------------------------------------------------------------------------
  // 5. Soft-deleted source
  // -------------------------------------------------------------------------
  console.log('\n[5] clone soft-deleted source → 404');
  {
    const softId = crypto.randomUUID();
    await db.insert(articlesTable).values({
      id: softId,
      title: 'Tombstoned',
      body: 'Already gone.',
      status: 'archived',
      deletedAt: new Date().toISOString(),
    });
    const res = await app.request(`/articles/${softId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('status 404', res.status === 404, `got ${res.status}`);
  }

  // -------------------------------------------------------------------------
  // 6. Original record remains intact in DB
  // -------------------------------------------------------------------------
  console.log('\n[6] original source row untouched after all clones');
  {
    const original = await db.select().from(articlesTable).where(sql`id = ${sourceId}`);
    check('source row still exists', original.length === 1);
    check('source title unchanged', original[0]?.title === 'On Composition');
    check('source publishedAt unchanged', original[0]?.publishedAt === '2026-05-01T10:00:00.000Z');
  }

  // -------------------------------------------------------------------------
  // Final: count of rows in the table.
  // -------------------------------------------------------------------------
  const all = await db.select().from(articlesTable);
  console.log(`\n[done] ${all.length} rows in 'articles' (1 seed + 3 clones + 1 soft-deleted = 5)`);
}

// Auto-run when invoked directly (tsx examples/drizzle/clone.ts).
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('clone.ts');

if (invokedDirectly) {
  runDemo()
    .then(() => {
      console.log('\n✓ all clone scenarios passed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n✗ demo failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

export { runDemo, ArticleClone, ArticleCloneAsDraft };
