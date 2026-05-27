/**
 * Tests for the Drizzle adapter's `dialect` option.
 *
 * Verifies that:
 * - `createDrizzleCrud` accepts an optional `{ dialect }` option and defaults
 *   to `'sqlite'` (preserves pre-existing portable behavior).
 * - `DrizzleUpsertEndpoint` / `DrizzleBatchUpsertEndpoint` route their native
 *   upsert call to `onConflictDoUpdate` (sqlite, pg) vs `onDuplicateKeyUpdate`
 *   (mysql), driven by `this.dialect` — replacing the previous try/catch
 *   fallback on error-string matching.
 *
 * The chosen verification strategy is a stub `db` that captures every method
 * call on the insert builder. This keeps the test database-driver-free and
 * dialect-driver-free (a real MySQL driver isn't available in the test
 * environment).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  defineModel,
  defineMeta,
  type DrizzleDialect,
} from 'hono-crud';
import {
  createDrizzleCrud,
  DrizzleUpsertEndpoint,
  DrizzleBatchUpsertEndpoint,
  type DrizzleDatabase,
} from '@hono-crud/drizzle';
import { substringMatch } from '@hono-crud/drizzle/advanced';
import { sql } from 'drizzle-orm';

// ============================================================================
// Test Schema / Model
// ============================================================================

const usersTable = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
});

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: usersTable,
});

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Stub db helpers
// ============================================================================

interface StubCall {
  method: string;
  args: unknown[];
}

interface StubDb {
  calls: StubCall[];
  db: DrizzleDatabase;
}

/**
 * Builds a minimal stub Drizzle database that records every method invoked
 * on an insert-builder chain and returns deterministic rows from `.returning()`.
 * The stub returns the same builder object from every chainable method so
 * call order can be inspected on `calls`.
 */
function makeStubDb(): StubDb {
  const calls: StubCall[] = [];

  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  const record = (method: string) =>
    function (...args: unknown[]) {
      calls.push({ method, args });
      return builder;
    };

  builder.values = record('values');
  builder.onConflictDoUpdate = record('onConflictDoUpdate');
  builder.onDuplicateKeyUpdate = record('onDuplicateKeyUpdate');
  builder.returning = function (..._args: unknown[]) {
    calls.push({ method: 'returning', args: [] });
    // Return a thenable so `await` resolves to a single fake row (or batch).
    return Promise.resolve([
      { id: '00000000-0000-0000-0000-000000000001', email: 'a@b.c', name: 'A' },
    ]);
  } as (...args: unknown[]) => unknown;

  const db = {
    insert(_table: unknown) {
      calls.push({ method: 'insert', args: [_table] });
      return builder;
    },
    select() {
      return { from() { return { where() { return { limit() { return Promise.resolve([]); } }; } }; } };
    },
    update() { return builder; },
    delete() { return builder; },
    transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(db);
    },
  } as unknown as DrizzleDatabase;

  return { calls, db };
}

/**
 * Builds a stub batch insert response with N rows.
 */
function makeStubBatchDb(rowCount: number): StubDb {
  const stub = makeStubDb();
  // Replace .returning() to yield rowCount rows.
  const builder = (stub.db as unknown as { insert: (t: unknown) => Record<string, (...args: unknown[]) => unknown> }).insert(null);
  builder.returning = function (..._args: unknown[]) {
    stub.calls.push({ method: 'returning', args: [] });
    return Promise.resolve(
      Array.from({ length: rowCount }, (_, i) => ({
        id: `id-${i}`,
        email: `u${i}@x.y`,
        name: `U${i}`,
      }))
    );
  } as (...args: unknown[]) => unknown;
  // Reset the recorded `insert` call from our priming call.
  stub.calls.length = 0;
  return stub;
}

// ============================================================================
// Tests
// ============================================================================

describe('createDrizzleCrud dialect option', () => {
  it('defaults to sqlite when no options are provided', async () => {
    const stub = makeStubDb();
    const User = createDrizzleCrud(stub.db, userMeta);

    // Drive nativeUpsert via the protected method to bypass HTTP plumbing.
    class UserUpsert extends User.Upsert {
      // Expose for the test.
      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    const ep = new UserUpsert();
    await ep.run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });

  it('routes upsert to onConflictDoUpdate when dialect is "sqlite"', async () => {
    const stub = makeStubDb();
    const User = createDrizzleCrud(stub.db, userMeta, { dialect: 'sqlite' });

    class UserUpsert extends User.Upsert {
      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    await new UserUpsert().run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });

  it('routes upsert to onConflictDoUpdate when dialect is "pg"', async () => {
    const stub = makeStubDb();
    const User = createDrizzleCrud(stub.db, userMeta, { dialect: 'pg' });

    class UserUpsert extends User.Upsert {
      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    await new UserUpsert().run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });

  it('routes upsert to onDuplicateKeyUpdate when dialect is "mysql"', async () => {
    const stub = makeStubDb();
    const User = createDrizzleCrud(stub.db, userMeta, { dialect: 'mysql' });

    class UserUpsert extends User.Upsert {
      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    await new UserUpsert().run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onDuplicateKeyUpdate');
    expect(calls).not.toContain('onConflictDoUpdate');
  });

  it('routes batch upsert to onConflictDoUpdate when dialect is "pg"', async () => {
    const stub = makeStubBatchDb(2);
    const User = createDrizzleCrud(stub.db, userMeta, { dialect: 'pg' });

    class UserBatchUpsert extends User.BatchUpsert {
      public async run(items: Array<Record<string, unknown>>) {
        return (this as unknown as {
          nativeBatchUpsert: (i: unknown) => Promise<unknown>;
        }).nativeBatchUpsert(items);
      }
    }

    await new UserBatchUpsert().run([
      { id: 'a', email: 'a@x.y', name: 'A' },
      { id: 'b', email: 'b@x.y', name: 'B' },
    ]);

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });

  it('routes batch upsert to onDuplicateKeyUpdate when dialect is "mysql"', async () => {
    const stub = makeStubBatchDb(2);
    const User = createDrizzleCrud(stub.db, userMeta, { dialect: 'mysql' });

    class UserBatchUpsert extends User.BatchUpsert {
      public async run(items: Array<Record<string, unknown>>) {
        return (this as unknown as {
          nativeBatchUpsert: (i: unknown) => Promise<unknown>;
        }).nativeBatchUpsert(items);
      }
    }

    await new UserBatchUpsert().run([
      { id: 'a', email: 'a@x.y', name: 'A' },
      { id: 'b', email: 'b@x.y', name: 'B' },
    ]);

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onDuplicateKeyUpdate');
    expect(calls).not.toContain('onConflictDoUpdate');
  });

  it('exports DrizzleDialect as a type from the package root', () => {
    // Pure type-level assertion: if this compiles, the type is exported.
    const sqlite: DrizzleDialect = 'sqlite';
    const pg: DrizzleDialect = 'pg';
    const mysql: DrizzleDialect = 'mysql';
    expect([sqlite, pg, mysql]).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

describe('DrizzleUpsertEndpoint dialect default', () => {
  it('subclass that does not set dialect inherits the "sqlite" default', async () => {
    const stub = makeStubDb();

    class UserUpsert extends DrizzleUpsertEndpoint {
      _meta = userMeta;
      db = stub.db;
      // Explicitly not setting `dialect` — should default to 'sqlite'.

      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    await new UserUpsert().run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });

  it('subclass overriding dialect to "mysql" routes to onDuplicateKeyUpdate', async () => {
    const stub = makeStubDb();

    class UserUpsert extends DrizzleUpsertEndpoint {
      _meta = userMeta;
      db = stub.db;
      protected override dialect: DrizzleDialect = 'mysql';

      public async run(data: Record<string, unknown>) {
        return (this as unknown as {
          nativeUpsert: (d: unknown) => Promise<unknown>;
        }).nativeUpsert(data);
      }
    }

    await new UserUpsert().run({ id: 'x', email: 'a@b.c', name: 'A' });

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onDuplicateKeyUpdate');
    expect(calls).not.toContain('onConflictDoUpdate');
  });
});

describe('substringMatch — dialect-native search SQL emission', () => {
  /**
   * Walks a drizzle `SQL` object's `queryChunks` and concatenates every
   * string fragment. Bound parameters are skipped — we only care about
   * the literal SQL function/keyword tokens emitted by the helper.
   */
  function literalChunks(s: ReturnType<typeof sql>): string {
    const chunks = (s as unknown as { queryChunks: Array<unknown> }).queryChunks;
    return chunks
      .map((c) => (typeof c === 'object' && c !== null && 'value' in (c as Record<string, unknown>) && Array.isArray((c as { value: unknown[] }).value)
        ? ((c as { value: string[] }).value).join('')
        : ''))
      .join('');
  }

  const col = sql`col`;

  it('sqlite emits INSTR(LOWER(col), LOWER(needle)) > 0', () => {
    const s = substringMatch(col, 'foo', 'sqlite');
    const text = literalChunks(s);
    expect(text).toContain('INSTR(');
    expect(text).toContain('> 0');
    expect(text).not.toContain('POSITION(');
    expect(text).not.toContain('LOCATE(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });

  it('pg emits POSITION(LOWER(needle) IN LOWER(col)) > 0', () => {
    const s = substringMatch(col, 'foo', 'pg');
    const text = literalChunks(s);
    expect(text).toContain('POSITION(');
    expect(text).toContain(' IN ');
    expect(text).toContain('> 0');
    expect(text).not.toContain('INSTR(');
    expect(text).not.toContain('LOCATE(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });

  it('mysql emits LOCATE(LOWER(needle), LOWER(col)) > 0', () => {
    const s = substringMatch(col, 'foo', 'mysql');
    const text = literalChunks(s);
    expect(text).toContain('LOCATE(');
    expect(text).toContain('> 0');
    expect(text).not.toContain('INSTR(');
    expect(text).not.toContain('POSITION(');
    expect(text).not.toContain('LIKE');
    expect(text).not.toContain('ESCAPE');
  });
});

describe('DrizzleBatchUpsertEndpoint dialect default', () => {
  it('subclass that does not set dialect inherits the "sqlite" default', async () => {
    const stub = makeStubBatchDb(1);

    class UserBatchUpsert extends DrizzleBatchUpsertEndpoint {
      _meta = userMeta;
      db = stub.db;

      public async run(items: Array<Record<string, unknown>>) {
        return (this as unknown as {
          nativeBatchUpsert: (i: unknown) => Promise<unknown>;
        }).nativeBatchUpsert(items);
      }
    }

    await new UserBatchUpsert().run([
      { id: 'a', email: 'a@x.y', name: 'A' },
    ]);

    const calls = stub.calls.map((c) => c.method);
    expect(calls).toContain('onConflictDoUpdate');
    expect(calls).not.toContain('onDuplicateKeyUpdate');
  });
});
