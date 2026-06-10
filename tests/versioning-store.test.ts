import type { VersionHistoryEntry } from 'hono-crud';
import { MemoryVersioningStorage } from 'hono-crud/versioning';
import { beforeEach, describe, expect, it } from 'vitest';

// §4.3 — VersioningStorage.store(tableName, entry) round-trip.
//
// The contract method `save(entry)` was renamed to `store(tableName, entry)`,
// and the old `entry.id.split(':')[0]` tableName-derivation hack was removed.
// These tests prove the per-table keying (getKey(tableName, recordId)) keeps
// two distinct tables that share a recordId fully isolated — a regression in
// the keying (e.g. dropping tableName from the key) would cross-contaminate.

function makeEntry(
  recordId: string | number,
  version: number,
  data: Record<string, unknown>,
): VersionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    recordId,
    version,
    data,
    createdAt: new Date(),
  };
}

describe('§4.3 VersioningStorage.store(tableName, entry)', () => {
  let storage: MemoryVersioningStorage;

  beforeEach(() => {
    storage = new MemoryVersioningStorage();
  });

  it('round-trips a stored entry via getByRecordId / getVersion / getLatestVersion', async () => {
    await storage.store('users', makeEntry('rec-1', 1, { name: 'Ada' }));

    const all = await storage.getByRecordId('users', 'rec-1');
    expect(all).toHaveLength(1);
    expect(all[0].data).toEqual({ name: 'Ada' });

    const v1 = await storage.getVersion('users', 'rec-1', 1);
    expect(v1).not.toBeNull();
    expect(v1!.version).toBe(1);

    expect(await storage.getLatestVersion('users', 'rec-1')).toBe(1);
  });

  it('keeps two tables sharing a recordId fully isolated (no cross-contamination)', async () => {
    // Same recordId '42', different tables — historically the split(':') hack
    // could have collapsed these into one bucket.
    await storage.store('users', makeEntry('42', 1, { kind: 'user-v1' }));
    await storage.store('users', makeEntry('42', 2, { kind: 'user-v2' }));
    await storage.store('orders', makeEntry('42', 1, { kind: 'order-v1' }));

    // getByRecordId must scope to the table.
    const userVersions = await storage.getByRecordId('users', '42');
    expect(userVersions).toHaveLength(2);
    expect(userVersions.map((v) => v.data)).toEqual(
      // newest-first ordering
      [{ kind: 'user-v2' }, { kind: 'user-v1' }],
    );

    const orderVersions = await storage.getByRecordId('orders', '42');
    expect(orderVersions).toHaveLength(1);
    expect(orderVersions[0].data).toEqual({ kind: 'order-v1' });

    // getVersion is table-scoped: 'orders' has no version 2.
    expect(await storage.getVersion('orders', '42', 2)).toBeNull();
    expect(await storage.getVersion('users', '42', 2)).not.toBeNull();

    // getLatestVersion is table-scoped.
    expect(await storage.getLatestVersion('users', '42')).toBe(2);
    expect(await storage.getLatestVersion('orders', '42')).toBe(1);
  });

  it('returns empty / zero for an unknown table+record', async () => {
    await storage.store('users', makeEntry('rec-1', 1, { name: 'Ada' }));

    expect(await storage.getByRecordId('comments', 'rec-1')).toEqual([]);
    expect(await storage.getVersion('comments', 'rec-1', 1)).toBeNull();
    expect(await storage.getLatestVersion('comments', 'rec-1')).toBe(0);
  });

  it('tags each stored entry with its tableName', async () => {
    await storage.store('users', makeEntry('rec-1', 1, { name: 'Ada' }));
    await storage.store('orders', makeEntry('rec-1', 1, { total: 10 }));

    const all = storage.getAllVersions() as Array<VersionHistoryEntry & { tableName: string }>;
    const tables = all.map((e) => e.tableName).sort();
    expect(tables).toEqual(['orders', 'users']);
  });
});
