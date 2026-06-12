/**
 * Cell 1 — FULL soft-delete lifecycle (audit finding 74).
 *
 * The headline contract no test pinned before this suite: a soft-deleted
 * record must 404 on read, update, AND delete-again — on every adapter.
 * Core's own docstrings promise this (core/src/endpoints/read.ts:14,
 * update.ts:25); the Prisma adapter shipped a violation precisely because
 * nothing asserted it.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  type SuccessEnvelope,
  createRecord,
  expectError,
  expectList,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';

export function registerSoftDeleteLifecycleCells(
  _descriptor: AdapterDescriptor,
  ctx: CtxGetter,
): void {
  test('soft-delete lifecycle: delete hides record from read/update/delete-again, onlyDeleted lists it, restore revives it', async () => {
    const { app } = ctx();

    const survivor = await createRecord(app, '/items', {
      name: 'Survivor',
      email: 'survivor@conformance.test',
      role: 'user',
      age: 30,
    });
    const victim = await createRecord(app, '/items', {
      name: 'Soft Target',
      email: 'victim@conformance.test',
      role: 'user',
      age: 31,
    });

    // Soft delete → 200 { deleted: true }
    const deleteResponse = await app.request(`/items/${victim.id}`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);
    const deleteBody = await readJson<SuccessEnvelope<{ deleted: boolean }>>(deleteResponse);
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.result.deleted).toBe(true);

    // Read of a soft-deleted record → 404 NOT_FOUND envelope.
    await expectError(await app.request(`/items/${victim.id}`), 404, 'NOT_FOUND');

    // Update of a soft-deleted record → 404 NOT_FOUND envelope.
    await expectError(
      await app.request(`/items/${victim.id}`, jsonInit('PATCH', { name: 'Zombie' })),
      404,
      'NOT_FOUND',
    );

    // Delete-again of a soft-deleted record → 404 NOT_FOUND envelope.
    await expectError(
      await app.request(`/items/${victim.id}`, { method: 'DELETE' }),
      404,
      'NOT_FOUND',
    );

    // Default list excludes the deleted record but keeps the live one.
    const defaultList = await expectList(await app.request('/items'));
    expect(defaultList.result.map((record) => record.id)).toEqual([survivor.id]);

    // ?withDeleted=true (core's softDeleteQueryParam default) includes both.
    const withDeleted = await expectList(await app.request('/items?withDeleted=true'));
    expect(withDeleted.result.map((record) => record.id).sort()).toEqual(
      [survivor.id, victim.id].sort(),
    );

    // ?onlyDeleted=true returns ONLY soft-deleted records.
    const onlyDeleted = await expectList(await app.request('/items?onlyDeleted=true'));
    expect(onlyDeleted.result.map((record) => record.id)).toEqual([victim.id]);

    // Restore → 200 with the record, soft-delete marker cleared.
    const restoreResponse = await app.request(`/items/${victim.id}/restore`, {
      method: 'POST',
    });
    const restored = await expectSuccess<ConformanceRecord>(restoreResponse, 200);
    expect(restored.id).toBe(victim.id);
    expect(restored.deletedAt).toBeNull();

    // Read after restore → 200 with the original data intact.
    const reRead = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${victim.id}`),
      200,
    );
    expect(reRead.id).toBe(victim.id);
    expect(reRead.name).toBe('Soft Target');
    expect(reRead.email).toBe('victim@conformance.test');
  });

  test('restore of a record that is not soft-deleted → 404 NOT_FOUND', async () => {
    const { app } = ctx();
    const record = await createRecord(app, '/items', {
      name: 'Never Deleted',
      email: 'never-deleted@conformance.test',
      role: 'user',
      age: 25,
    });

    await expectError(
      await app.request(`/items/${record.id}/restore`, { method: 'POST' }),
      404,
      'NOT_FOUND',
    );
  });

  test('restore of a missing id → 404 NOT_FOUND', async () => {
    const { app } = ctx();
    await expectError(
      await app.request('/items/00000000-0000-4000-8000-000000000999/restore', {
        method: 'POST',
      }),
      404,
      'NOT_FOUND',
    );
  });
}
