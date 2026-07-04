import { DrizzleAuditLogStorage, sqliteAuditLogTable } from '@hono-crud/drizzle';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import type { AuditLogEntry } from 'hono-crud/audit';
/**
 * Tests for the durable Drizzle-backed AuditLogStorage (D1/libsql/…).
 * Uses SQLite via libsql, mirroring tests/drizzle-versioning-storage.test.ts.
 * Semantics are pinned against MemoryAuditLogStorage (packages/core/src/audit):
 * AND-combined filters, inclusive (>= / <=) date range, oldest-first order,
 * offset/limit slicing (falsy limit = "all").
 */
import { beforeEach, describe, expect, it } from 'vitest';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const table = sqliteAuditLogTable();
const storage = new DrizzleAuditLogStorage({ db, table });

const BASE_TS = 1_700_000_000_000;

function entry(
  recordId: string,
  seq: number,
  extra: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id: `${recordId}-${seq}`,
    timestamp: new Date(BASE_TS + seq * 1000),
    action: 'create',
    tableName: 'documents',
    recordId,
    ...extra,
  };
}

beforeEach(async () => {
  await db.run(sql`DROP TABLE IF EXISTS audit_logs`);
  await db.run(sql`
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      user_id TEXT,
      record TEXT,
      previous_record TEXT,
      changes TEXT,
      metadata TEXT
    )
  `);
});

describe('DrizzleAuditLogStorage', () => {
  it('stores and lists a record oldest-first with a real Date timestamp', async () => {
    await storage.store(entry('A', 0));
    await storage.store(entry('A', 1));

    const logs = await storage.getByRecordId('documents', 'A');
    expect(logs.map((l) => l.id)).toEqual(['A-0', 'A-1']);
    expect(logs[0].timestamp).toBeInstanceOf(Date);
    expect(logs[0].timestamp.getTime()).toBe(BASE_TS);
    expect(logs[0].action).toBe('create');
  });

  it('getByRecordId discriminates by tableName + recordId', async () => {
    await storage.store(entry('A', 0));
    await storage.store(entry('B', 1));
    await storage.store(entry('A', 2, { tableName: 'other' }));

    expect((await storage.getByRecordId('documents', 'A')).length).toBe(1);
    expect((await storage.getByRecordId('documents', 'B')).length).toBe(1);
    expect((await storage.getByRecordId('other', 'A')).length).toBe(1);
    expect(await storage.getByRecordId('documents', 'missing')).toEqual([]);
  });

  it('getByRecordId honors limit / offset (oldest-first)', async () => {
    for (let i = 0; i < 5; i++) await storage.store(entry('A', i));

    const page = await storage.getByRecordId('documents', 'A', { limit: 2, offset: 1 });
    expect(page.map((l) => l.id)).toEqual(['A-1', 'A-2']);
  });

  it('getByRecordId supports offset without limit (SQLite needs a LIMIT for OFFSET)', async () => {
    for (let i = 0; i < 5; i++) await storage.store(entry('A', i));

    const page = await storage.getByRecordId('documents', 'A', { offset: 2 });
    expect(page.map((l) => l.id)).toEqual(['A-2', 'A-3', 'A-4']);
  });

  it('getAll with no options returns everything oldest-first', async () => {
    await storage.store(entry('A', 0));
    await storage.store(entry('B', 1, { tableName: 'posts' }));

    const all = await storage.getAll();
    expect(all.map((l) => l.id)).toEqual(['A-0', 'B-1']);
  });

  it('getAll filters by tableName', async () => {
    await storage.store(entry('A', 0));
    await storage.store(entry('B', 1, { tableName: 'posts' }));

    const logs = await storage.getAll({ tableName: 'posts' });
    expect(logs.map((l) => l.id)).toEqual(['B-1']);
  });

  it('getAll filters by action', async () => {
    await storage.store(entry('A', 0, { action: 'create' }));
    await storage.store(entry('A', 1, { action: 'update' }));
    await storage.store(entry('A', 2, { action: 'delete' }));

    const logs = await storage.getAll({ action: 'update' });
    expect(logs.map((l) => l.id)).toEqual(['A-1']);
  });

  it('getAll filters by userId', async () => {
    await storage.store(entry('A', 0, { userId: 'u1' }));
    await storage.store(entry('A', 1, { userId: 'u2' }));

    const logs = await storage.getAll({ userId: 'u2' });
    expect(logs.map((l) => l.id)).toEqual(['A-1']);
  });

  it('getAll date range is inclusive on both ends (>= start, <= end)', async () => {
    // Timestamps at BASE_TS, +1000, +2000, +3000.
    for (let i = 0; i < 4; i++) await storage.store(entry('A', i));

    const start = new Date(BASE_TS + 1000);
    const end = new Date(BASE_TS + 2000);
    const logs = await storage.getAll({ startDate: start, endDate: end });
    // Exact boundary rows (+1000 and +2000) are included.
    expect(logs.map((l) => l.id)).toEqual(['A-1', 'A-2']);
  });

  it('getAll startDate alone is inclusive', async () => {
    for (let i = 0; i < 3; i++) await storage.store(entry('A', i));
    const logs = await storage.getAll({ startDate: new Date(BASE_TS + 1000) });
    expect(logs.map((l) => l.id)).toEqual(['A-1', 'A-2']);
  });

  it('getAll endDate alone is inclusive', async () => {
    for (let i = 0; i < 3; i++) await storage.store(entry('A', i));
    const logs = await storage.getAll({ endDate: new Date(BASE_TS + 1000) });
    expect(logs.map((l) => l.id)).toEqual(['A-0', 'A-1']);
  });

  it('getAll combines every filter dimension with AND', async () => {
    await storage.store(entry('A', 0, { action: 'update', userId: 'u1' }));
    await storage.store(entry('A', 1, { action: 'update', userId: 'u1' }));
    await storage.store(entry('A', 2, { action: 'delete', userId: 'u1' }));
    await storage.store(entry('B', 1, { tableName: 'posts', action: 'update', userId: 'u1' }));

    const logs = await storage.getAll({
      tableName: 'documents',
      action: 'update',
      userId: 'u1',
      startDate: new Date(BASE_TS + 1000),
      endDate: new Date(BASE_TS + 2000),
    });
    expect(logs.map((l) => l.id)).toEqual(['A-1']);
  });

  it('getAll honors limit / offset (oldest-first)', async () => {
    for (let i = 0; i < 5; i++) await storage.store(entry('A', i));

    const page = await storage.getAll({ limit: 2, offset: 1 });
    expect(page.map((l) => l.id)).toEqual(['A-1', 'A-2']);
  });

  it('getAll treats a falsy limit (0) as "all", mirroring MemoryAuditLogStorage', async () => {
    for (let i = 0; i < 3; i++) await storage.store(entry('A', i));

    const logs = await storage.getAll({ limit: 0 });
    expect(logs.map((l) => l.id)).toEqual(['A-0', 'A-1', 'A-2']);
  });

  it('round-trips record / previousRecord / changes / metadata as JSON', async () => {
    await storage.store(
      entry('A', 0, {
        action: 'update',
        userId: 'u1',
        record: { id: 'A', title: 'new' },
        previousRecord: { id: 'A', title: 'old' },
        changes: [{ field: 'title', oldValue: 'old', newValue: 'new' }],
        metadata: { source: 'api', created: false },
      }),
    );

    const [log] = await storage.getByRecordId('documents', 'A');
    expect(log.record).toEqual({ id: 'A', title: 'new' });
    expect(log.previousRecord).toEqual({ id: 'A', title: 'old' });
    expect(log.changes).toEqual([{ field: 'title', oldValue: 'old', newValue: 'new' }]);
    expect(log.metadata).toEqual({ source: 'api', created: false });
  });

  it('passes an encrypted-envelope object through untouched', async () => {
    const envelope = { ct: 'base64ciphertext', iv: 'base64iv', v: 1 };
    await storage.store(entry('A', 0, { record: { id: 'A', secret: envelope } }));

    const [log] = await storage.getByRecordId('documents', 'A');
    expect(log.record).toEqual({ id: 'A', secret: envelope });
  });

  it('omits optional fields entirely when absent', async () => {
    await storage.store(entry('A', 0));
    const [log] = await storage.getByRecordId('documents', 'A');
    expect('userId' in log).toBe(false);
    expect('record' in log).toBe(false);
    expect('previousRecord' in log).toBe(false);
    expect('changes' in log).toBe(false);
    expect('metadata' in log).toBe(false);
  });

  it('returns an empty array when getAll filters match nothing', async () => {
    await storage.store(entry('A', 0));
    expect(await storage.getAll({ action: 'delete' })).toEqual([]);
    expect(await storage.getAll({ tableName: 'nope' })).toEqual([]);
    expect(await storage.getAll({ userId: 'ghost' })).toEqual([]);
  });
});
