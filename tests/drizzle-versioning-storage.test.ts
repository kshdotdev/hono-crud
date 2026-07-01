import { DrizzleVersioningStorage, sqliteVersionHistoryTable } from '@hono-crud/drizzle';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import type { VersionHistoryEntry } from 'hono-crud/versioning';
/**
 * Tests for the durable Drizzle-backed VersioningStorage (D1/libsql/…).
 * Uses SQLite via libsql, mirroring tests/drizzle.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const table = sqliteVersionHistoryTable();
const storage = new DrizzleVersioningStorage({ db, table });

function entry(
  recordId: string,
  version: number,
  extra: Partial<VersionHistoryEntry> = {},
): VersionHistoryEntry {
  return {
    id: `${recordId}-v${version}`,
    recordId,
    version,
    data: { id: recordId, title: `T${version}` },
    createdAt: new Date(1_700_000_000_000 + version * 1000),
    ...extra,
  };
}

beforeEach(async () => {
  await db.run(sql`DROP TABLE IF EXISTS version_history`);
  await db.run(sql`
    CREATE TABLE version_history (
      id TEXT PRIMARY KEY,
      resource_table TEXT NOT NULL,
      record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      changed_by TEXT,
      change_reason TEXT,
      changes TEXT
    )
  `);
});

describe('DrizzleVersioningStorage', () => {
  it('stores and lists versions newest-first', async () => {
    await storage.store('documents', entry('A', 0));
    await storage.store('documents', entry('A', 1));

    const versions = await storage.getByRecordId('documents', 'A');
    expect(versions.map((v) => v.version)).toEqual([1, 0]);
    expect(versions[0].data).toEqual({ id: 'A', title: 'T1' });
    expect(versions[0].createdAt).toBeInstanceOf(Date);
    expect(versions[0].createdAt.getTime()).toBe(1_700_000_001_000);
  });

  it('reads a specific version and the latest version number', async () => {
    await storage.store('documents', entry('A', 0));
    await storage.store('documents', entry('A', 1));

    const v0 = await storage.getVersion('documents', 'A', 0);
    expect(v0?.data).toEqual({ id: 'A', title: 'T0' });
    expect(await storage.getLatestVersion('documents', 'A')).toBe(1);
    expect(await storage.getVersion('documents', 'A', 99)).toBeNull();
    expect(await storage.getLatestVersion('documents', 'missing')).toBe(0);
  });

  it('discriminates by resourceTable and recordId (shared table)', async () => {
    await storage.store('documents', entry('A', 0));
    await storage.store('other', { ...entry('A', 0), id: 'other-A-0' });
    await storage.store('documents', entry('B', 0));

    expect((await storage.getByRecordId('documents', 'A')).length).toBe(1);
    expect((await storage.getByRecordId('other', 'A')).length).toBe(1);
    expect((await storage.getByRecordId('documents', 'B')).length).toBe(1);
  });

  it('round-trips changedBy / changeReason / changes', async () => {
    await storage.store(
      'documents',
      entry('A', 0, {
        changedBy: 'user-1',
        changeReason: 'edited',
        changes: [{ field: 'title', oldValue: 'x', newValue: 'y' }],
      }),
    );

    const [v] = await storage.getByRecordId('documents', 'A');
    expect(v.changedBy).toBe('user-1');
    expect(v.changeReason).toBe('edited');
    expect(v.changes).toEqual([{ field: 'title', oldValue: 'x', newValue: 'y' }]);
  });

  it('omits optional fields entirely when absent', async () => {
    await storage.store('documents', entry('A', 0));
    const [v] = await storage.getByRecordId('documents', 'A');
    expect('changedBy' in v).toBe(false);
    expect('changeReason' in v).toBe(false);
    expect('changes' in v).toBe(false);
  });

  it('honors limit / offset', async () => {
    for (let i = 0; i < 5; i++) await storage.store('documents', entry('A', i));

    const page = await storage.getByRecordId('documents', 'A', { limit: 2, offset: 1 });
    expect(page.map((v) => v.version)).toEqual([3, 2]);
  });

  it('supports offset without limit (SQLite needs a LIMIT for OFFSET)', async () => {
    for (let i = 0; i < 5; i++) await storage.store('documents', entry('A', i));

    // Would throw "near \"offset\": syntax error" without the LIMIT -1 fix.
    const page = await storage.getByRecordId('documents', 'A', { offset: 2 });
    expect(page.map((v) => v.version)).toEqual([2, 1, 0]);
  });

  it('prunes to keepCount, keeping the newest', async () => {
    for (let i = 0; i < 5; i++) await storage.store('documents', entry('A', i));

    const deleted = await storage.pruneVersions('documents', 'A', 2);
    expect(deleted).toBe(3);
    expect((await storage.getByRecordId('documents', 'A')).map((v) => v.version)).toEqual([4, 3]);
  });

  it('pruneVersions is a no-op when at/under keepCount', async () => {
    await storage.store('documents', entry('A', 0));
    expect(await storage.pruneVersions('documents', 'A', 5)).toBe(0);
  });

  it('pruneVersions with keepCount <= 0 deletes all (no crash)', async () => {
    for (let i = 0; i < 3; i++) await storage.store('documents', entry('A', i));

    // Would throw TypeError on existing[-1].version without the guard.
    const deleted = await storage.pruneVersions('documents', 'A', 0);
    expect(deleted).toBe(3);
    expect((await storage.getByRecordId('documents', 'A')).length).toBe(0);
  });

  it('deleteAllVersions removes only the target record', async () => {
    await storage.store('documents', entry('A', 0));
    await storage.store('documents', entry('A', 1));
    await storage.store('documents', entry('B', 0));

    const deleted = await storage.deleteAllVersions('documents', 'A');
    expect(deleted).toBe(2);
    expect((await storage.getByRecordId('documents', 'A')).length).toBe(0);
    expect((await storage.getByRecordId('documents', 'B')).length).toBe(1);
  });
});
