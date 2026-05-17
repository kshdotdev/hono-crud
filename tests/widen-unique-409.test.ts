/**
 * Widen UNIQUE-violation → 409 mapping to every insert path.
 *
 * Prior to this change (0.12.2), only the `clone` endpoint mapped an
 * adapter-level UNIQUE-constraint violation to the engine's standard
 * `{success:false, error:{code:"CONFLICT", …}}` 409 envelope (see
 * `tests/managed-fields-coverage.test.ts`). Every other insert path —
 * `create`, `batchCreate`, `upsert` (incl. `nativeUpsert`),
 * `batchUpsert` (incl. `nativeBatchUpsert`) and `import` — would bubble
 * the raw driver error as a plaintext 500. This file exercises a real
 * UNIQUE constraint via libsql/drizzle on each of those paths and
 * asserts the engine's standard 409 envelope is returned.
 *
 * The idiomatic refactor of `mapUniqueViolation` (data-driven code set +
 * shared `causeChain` walker + centralised `withConstraintErrorMapping`)
 * is also regression-tested here against the same fixtures the previous
 * inline implementation passed.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import {
  fromHono,
  defineModel,
  defineMeta,
  mapUniqueViolation,
  causeChain,
  withConstraintErrorMapping,
  ConflictException,
} from '../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleBatchCreateEndpoint,
  DrizzleUpsertEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleImportEndpoint,
  type DrizzleDatabase,
} from '../src/adapters/drizzle/index.js';

// ============================================================================
// Shared drizzle/libsql fixture — a table with a non-PK UNIQUE column.
// ============================================================================

const widgets = sqliteTable('w409_widgets', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
});
const WidgetSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  priceCents: z.number(),
});
const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const model = defineModel({
  tableName: 'w409_widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
  table: widgets,
});
const meta = defineMeta({ model });

// Memory-adapter has no UNIQUE constraint, so each insert path uses the
// drizzle adapter against a real SQLite (`:memory:`) — the same approach
// `tests/managed-fields-coverage.test.ts` uses for the clone 409 case.
class WidgetCreate extends DrizzleCreateEndpoint<any, typeof meta> {
  _meta = meta;
  db = db as unknown as DrizzleDatabase;
}
class WidgetBatchCreate extends DrizzleBatchCreateEndpoint<any, typeof meta> {
  _meta = meta;
  db = db as unknown as DrizzleDatabase;
}
class WidgetUpsertById extends DrizzleUpsertEndpoint<any, typeof meta> {
  _meta = meta;
  db = db as unknown as DrizzleDatabase;
  // Match on `id` so a duplicate `slug` (a different UNIQUE column) is a
  // genuine violation, not just an upsert.
  protected upsertKeys = ['id'];
}
class WidgetBatchUpsertById extends DrizzleBatchUpsertEndpoint<any, typeof meta> {
  _meta = meta;
  db = db as unknown as DrizzleDatabase;
  protected upsertKeys = ['id'];
}
class WidgetImport extends DrizzleImportEndpoint<any, typeof meta> {
  _meta = meta;
  db = db as unknown as DrizzleDatabase;
}

function buildApp(): Hono {
  const app = fromHono(new Hono());
  app.post('/widgets', WidgetCreate as any);
  app.post('/widgets/batch', WidgetBatchCreate as any);
  app.post('/widgets/upsert', WidgetUpsertById as any);
  app.post('/widgets/batch-upsert', WidgetBatchUpsertById as any);
  app.post('/widgets/import', WidgetImport as any);
  return app;
}

beforeAll(async () => {
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS w409_widgets (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price_cents INTEGER NOT NULL)`
  );
});

beforeEach(async () => {
  await db.delete(widgets);
  // Seed a row that collides on `slug` with the test bodies below.
  await db.insert(widgets).values({
    id: 'seed',
    slug: 'taken',
    name: 'Seed',
    priceCents: 100,
  });
});

// ============================================================================
// 1. create — duplicate-unique insert → 409 JSON envelope
// ============================================================================

describe('CreateEndpoint: UNIQUE violation → 409 envelope (drizzle)', () => {
  it('plain duplicate-slug create surfaces as 409 (not 500, not plaintext)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'taken', name: 'Dup', priceCents: 200 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(typeof body.error.message).toBe('string');
  });

  it('distinct slug succeeds (regression — only collisions 409)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'fresh', name: 'Fresh', priceCents: 200 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: { slug: string } };
    expect(body.result.slug).toBe('fresh');
  });
});

// ============================================================================
// 2. batchCreate — at least one item collides → 409 envelope
// ============================================================================

describe('BatchCreateEndpoint: UNIQUE violation in batch → 409 envelope (drizzle)', () => {
  it('batch with a colliding item surfaces as 409 (matches existing batch error shape)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { slug: 'one', name: 'One', priceCents: 1 },
          { slug: 'taken', name: 'Dup', priceCents: 2 }, // collides
        ],
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('batch with all-distinct slugs succeeds (regression)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { slug: 'b1', name: 'B1', priceCents: 1 },
          { slug: 'b2', name: 'B2', priceCents: 2 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      result: { count: number };
    };
    expect(body.result.count).toBe(2);
  });
});

// ============================================================================
// 3. upsert — UNIQUE collision on a non-upsert-key column → 409 envelope
// ============================================================================

describe('UpsertEndpoint: UNIQUE on non-upsert-key column → 409 envelope (drizzle)', () => {
  it('upsert by id with a slug colliding on a different existing row → 409', async () => {
    // Upsert key is `id`, so `id:'fresh'` is a CREATE branch — but
    // `slug:'taken'` collides with the seed row's UNIQUE slug. Prior to
    // this fix that was a plaintext 500.
    const app = buildApp();
    const res = await app.request('/widgets/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fresh', slug: 'taken', name: 'X', priceCents: 5 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: false;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('upsert by id with a distinct slug succeeds (regression)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fresh', slug: 'fresh-slug', name: 'X', priceCents: 5 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      result: { id: string; slug: string };
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.result.slug).toBe('fresh-slug');
  });
});

// ============================================================================
// 4. batchUpsert — same coverage as single upsert
// ============================================================================

describe('BatchUpsertEndpoint: UNIQUE on non-upsert-key column → 409 envelope (drizzle)', () => {
  it('batch upsert with one item colliding on slug → 409', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/batch-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { id: 'bu-1', slug: 'fresh-1', name: 'A', priceCents: 1 },
        { id: 'bu-2', slug: 'taken', name: 'B', priceCents: 2 }, // collides
      ]),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: false;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('batch upsert with all distinct slugs succeeds (regression)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/batch-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { id: 'bu-3', slug: 'bu-s-3', name: 'A', priceCents: 1 },
        { id: 'bu-4', slug: 'bu-s-4', name: 'B', priceCents: 2 },
      ]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { totalCount: number; createdCount: number };
    };
    expect(body.result.totalCount).toBe(2);
    expect(body.result.createdCount).toBe(2);
  });
});

// ============================================================================
// 5. import — per-row UNIQUE collision → CONFLICT-coded row, not global 500
// ============================================================================

describe('ImportEndpoint: per-row UNIQUE violation → CONFLICT-coded row result', () => {
  it('row that violates UNIQUE constraint is reported per-row with code:CONFLICT (no global 500)', async () => {
    const app = buildApp();
    const res = await app.request('/widgets/import?mode=create&skipInvalid=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: 'imp-1', slug: 'fresh-imp-1', name: 'A', priceCents: 1 },
          { id: 'imp-2', slug: 'taken', name: 'B', priceCents: 2 }, // collides
        ],
      }),
    });
    // Per-row failure → 207 Multi-Status (existing import behaviour),
    // never a global 500.
    expect([200, 207]).toContain(res.status);
    const body = (await res.json()) as {
      success: true;
      result: {
        summary: { created: number; failed: number; total: number };
        results: Array<{
          rowNumber: number;
          status: string;
          code?: string;
          error?: string;
        }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.result.summary.total).toBe(2);
    expect(body.result.summary.created).toBe(1);
    expect(body.result.summary.failed).toBe(1);

    const failed = body.result.results.find((r) => r.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.code).toBe('CONFLICT');
    expect(typeof failed!.error).toBe('string');
  });
});

// ============================================================================
// 6. Idiomatic refactor regression — every shape that PR-E covered still
// maps, and the newly-exported `causeChain` walker is callable and bounded.
// ============================================================================

describe('mapUniqueViolation refactor: idiomatic shape preserves every adapter case', () => {
  it.each([
    {
      label: 'Prisma P2002',
      err: { name: 'PrismaClientKnownRequestError', code: 'P2002', message: 'x' },
    },
    {
      label: 'SQLite SQLITE_CONSTRAINT_UNIQUE',
      err: { code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed' },
    },
    {
      label: 'SQLite generic SQLITE_CONSTRAINT',
      err: { code: 'SQLITE_CONSTRAINT', message: 'something' },
    },
    {
      label: 'PostgreSQL 23505',
      err: { code: '23505', message: 'duplicate key value violates unique constraint' },
    },
    {
      label: 'MySQL ER_DUP_ENTRY',
      err: { code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x'" },
    },
    {
      label: 'MySQL numeric 1062',
      err: { code: 1062, message: "Duplicate entry 'x'" },
    },
    {
      label: 'MySQL string 1062',
      err: { code: '1062', message: "Duplicate entry 'x'" },
    },
    {
      label: 'fallback regex on message only',
      err: { message: 'UNIQUE constraint failed: t.col' },
    },
  ])('$label → ConflictException(409)', ({ err }) => {
    const out = mapUniqueViolation(err);
    expect(out).toBeInstanceOf(ConflictException);
    expect(out!.status).toBe(409);
    expect(out!.code).toBe('CONFLICT');
  });

  it('walks an Error.cause chain (drizzle wraps the driver error)', () => {
    const driver = Object.assign(new Error('UNIQUE constraint failed: w.s'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    const wrapper = new Error('DrizzleQueryError: failed to execute');
    (wrapper as { cause?: unknown }).cause = driver;
    const out = mapUniqueViolation(wrapper);
    expect(out).toBeInstanceOf(ConflictException);
  });

  it('non-unique / non-error inputs → null', () => {
    expect(mapUniqueViolation(new Error('boom'))).toBeNull();
    expect(mapUniqueViolation(null)).toBeNull();
    expect(mapUniqueViolation(undefined)).toBeNull();
    expect(mapUniqueViolation('plain string')).toBeNull();
    expect(mapUniqueViolation({ code: '23502', message: 'not-null' })).toBeNull();
  });
});

describe('causeChain: bounded, ordered, exported', () => {
  it('yields the original error first, then each cause link in order', () => {
    const c = new Error('deepest');
    const b = Object.assign(new Error('middle'), { cause: c });
    const a = Object.assign(new Error('outer'), { cause: b });
    const seen = [...causeChain(a)];
    expect(seen).toEqual([a, b, c]);
  });

  it('stops at maxDepth even for a cycle', () => {
    const a: { cause?: unknown; n: number } = { n: 1 };
    const b: { cause?: unknown; n: number } = { n: 2 };
    a.cause = b;
    b.cause = a; // cycle
    const seen = [...causeChain(a, 4)];
    expect(seen.length).toBe(4);
  });

  it('stops at maxDepth for a long chain', () => {
    type Node = { n: number; cause?: Node };
    let head: Node = { n: 0 };
    for (let i = 1; i < 50; i++) head = { n: i, cause: head };
    const seen = [...causeChain(head, 5)];
    expect(seen.length).toBe(5);
  });

  it('handles non-object inputs gracefully', () => {
    expect([...causeChain(null)]).toEqual([]);
    expect([...causeChain(undefined)]).toEqual([]);
    expect([...causeChain('plain')]).toEqual([]);
  });
});

describe('withConstraintErrorMapping: passes through success, maps unique violations, rethrows others', () => {
  it('returns the value when work() resolves', async () => {
    const out = await withConstraintErrorMapping(async () => 42);
    expect(out).toBe(42);
  });

  it('translates a unique-violation throw to a ConflictException', async () => {
    await expect(
      withConstraintErrorMapping(async () => {
        throw Object.assign(new Error('UNIQUE constraint failed: t.col'), {
          code: 'SQLITE_CONSTRAINT_UNIQUE',
        });
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows any non-unique error unchanged', async () => {
    const original = new Error('something else');
    await expect(
      withConstraintErrorMapping(async () => {
        throw original;
      })
    ).rejects.toBe(original);
  });
});
