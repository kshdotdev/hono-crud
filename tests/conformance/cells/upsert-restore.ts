/**
 * Cell 9 — Upsert vs soft-deleted rows: match-and-restore (audit finding 43).
 *
 * TARGET contract (pinned here; core/src/endpoints/upsert.ts documents it):
 * an upsert whose upsertKeys match a SOFT-DELETED row MATCHES that row and
 * RESTORES it (clears the soft-delete field) instead of creating a
 * duplicate. Identity is preserved (same id), the response counts as an
 * update (`created: false`, 200), and single upsert and batchUpsert behave
 * identically.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type BatchUpsertResult,
  type ConformanceRecord,
  type CtxGetter,
  type UpsertEnvelope,
  createRecord,
  expectError,
  expectList,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';

async function createAndSoftDelete(ctx: CtxGetter, email: string): Promise<ConformanceRecord> {
  const { app } = ctx();
  const created = await createRecord(app, '/items', {
    name: 'Phoenix',
    email,
    role: 'user',
    age: 40,
  });
  const deleteResponse = await app.request(`/items/${created.id}`, { method: 'DELETE' });
  expect(deleteResponse.status).toBe(200);
  // Sanity: the row really is hidden before the upsert.
  await expectError(await app.request(`/items/${created.id}`), 404, 'NOT_FOUND');
  return created;
}

export function registerUpsertRestoreCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('upsert matching a soft-deleted row by upsertKeys restores it instead of duplicating (created: false, 200)', async () => {
    const { app } = ctx();
    const email = 'phoenix@conformance.test';
    const original = await createAndSoftDelete(ctx, email);

    const upsertResponse = await app.request(
      '/items/upsert',
      jsonInit('POST', { name: 'Phoenix Reborn', email, role: 'user', age: 41 }),
    );
    expect(upsertResponse.status).toBe(200);
    const body = await readJson<UpsertEnvelope<ConformanceRecord>>(upsertResponse);
    expect(body.success).toBe(true);
    expect(body.created).toBe(false);
    expect(body.result.id).toBe(original.id);
    expect(body.result.deletedAt).toBeNull();
    expect(body.result.name).toBe('Phoenix Reborn');

    // Exactly one row with that email exists, even counting soft-deleted rows.
    const all = await expectList(await app.request('/items?withDeleted=true'));
    expect(all.result.filter((record) => record.email === email)).toHaveLength(1);

    // The row is readable again with the upserted data.
    const reRead = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${original.id}`),
      200,
    );
    expect(reRead.name).toBe('Phoenix Reborn');
  });

  test('batchUpsert matching a soft-deleted row behaves identically to single upsert (match-and-restore)', async () => {
    const { app } = ctx();
    const email = 'batch-phoenix@conformance.test';
    const original = await createAndSoftDelete(ctx, email);

    // NOTE: batchUpsert's request body is a bare array (unlike batchCreate).
    const response = await app.request(
      '/items/batch/upsert',
      jsonInit('POST', [{ name: 'Batch Reborn', email, role: 'user', age: 42 }]),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{
      success: true;
      result: BatchUpsertResult<ConformanceRecord>;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.result.createdCount).toBe(0);
    expect(body.result.updatedCount).toBe(1);
    expect(body.result.totalCount).toBe(1);
    expect(body.result.items).toHaveLength(1);
    expect(body.result.items[0]?.created).toBe(false);
    expect(body.result.items[0]?.data.id).toBe(original.id);
    expect(body.result.items[0]?.data.deletedAt).toBeNull();
    expect(body.result.items[0]?.data.name).toBe('Batch Reborn');

    const all = await expectList(await app.request('/items?withDeleted=true'));
    expect(all.result.filter((record) => record.email === email)).toHaveLength(1);

    const reRead = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${original.id}`),
      200,
    );
    expect(reRead.name).toBe('Batch Reborn');
  });
}
