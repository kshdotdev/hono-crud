/**
 * Cell — Bulk patch (`PATCH /items/bulk`).
 *
 * Pins the cross-adapter bulk-patch contract:
 * - only records matching the query-string filter are patched;
 * - soft-deleted records are NEVER patched, even when they match the filter
 *   (and are not counted as matched);
 * - managed `updatedAt` is strictly bumped on every patched record;
 * - the response reports exact `matched`/`updated` counts with
 *   `dryRun: false`;
 * - `?dryRun=true` reports the count without writing.
 */
import { expect, test } from 'vitest';
import type { AdapterDescriptor, ConformanceRecord, CtxGetter } from '../contract';
import {
  expectError,
  expectList,
  expectSuccess,
  jsonInit,
  readJson,
  sleep,
  timestampToMillis,
} from '../contract';
import { seedFilterRows } from '../model';

/** The flat (non-envelope) response body BulkPatchEndpoint emits. */
interface BulkPatchBody {
  success: boolean;
  matched: number;
  updated: number;
  dryRun: boolean;
}

export function registerBulkPatchCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('bulk patch: patches only the filtered subset, never soft-deleted rows, and bumps updatedAt', async () => {
    const { app } = ctx();
    const byEmail = await seedFilterRows(app, '/items');

    // FILTER_SEED guests: carol (age 40) and dave (age 50).
    const carol = byEmail.get('carol@conformance.test') as ConformanceRecord;
    const dave = byEmail.get('dave@conformance.test') as ConformanceRecord;
    const alice = byEmail.get('alice@conformance.test') as ConformanceRecord;

    // Soft-delete dave: he still matches role=guest but must NOT be patched.
    const deleteResponse = await app.request(`/items/${dave.id}`, { method: 'DELETE' });
    expect(deleteResponse.status).toBe(200);

    const carolUpdatedBefore = timestampToMillis(
      carol.updatedAt,
      descriptor.capabilities.timestampKind,
    );

    // Make the updatedAt bump observable on millisecond-resolution backends.
    await sleep(5);

    const patchResponse = await app.request('/items/bulk?role=guest', jsonInit('PATCH', { age: 99 }));
    expect(patchResponse.status).toBe(200);
    const body = await readJson<BulkPatchBody>(patchResponse);
    expect(body).toEqual({ success: true, matched: 1, updated: 1, dryRun: false });

    // Carol (visible guest) was patched, with updatedAt strictly bumped.
    const carolAfter = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${carol.id}`),
      200,
    );
    expect(carolAfter.age).toBe(99);
    const carolUpdatedAfter = timestampToMillis(
      carolAfter.updatedAt,
      descriptor.capabilities.timestampKind,
    );
    expect(carolUpdatedAfter).toBeGreaterThan(carolUpdatedBefore);

    // Dave stays soft-deleted (404 on read) and his data is untouched.
    await expectError(await app.request(`/items/${dave.id}`), 404, 'NOT_FOUND');
    const onlyDeleted = await expectList(await app.request('/items?onlyDeleted=true'));
    expect(onlyDeleted.result.map((record) => record.id)).toEqual([dave.id]);
    expect(onlyDeleted.result[0].age).toBe(50);

    // Non-matching visible rows are untouched.
    const aliceAfter = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${alice.id}`),
      200,
    );
    expect(aliceAfter.age).toBe(35);
  });

  test('bulk patch: dryRun=true reports the matched count without writing', async () => {
    const { app } = ctx();
    const byEmail = await seedFilterRows(app, '/items');

    const dryRunResponse = await app.request(
      '/items/bulk?role=user&dryRun=true',
      jsonInit('PATCH', { age: 77 }),
    );
    expect(dryRunResponse.status).toBe(200);
    const body = await readJson<BulkPatchBody>(dryRunResponse);
    // FILTER_SEED has exactly two role=user rows (cooper + bob).
    expect(body).toEqual({ success: true, matched: 2, updated: 0, dryRun: true });

    // Nothing was written.
    const cooper = byEmail.get('cooper@conformance.test') as ConformanceRecord;
    const cooperAfter = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${cooper.id}`),
      200,
    );
    expect(cooperAfter.age).toBe(28);
  });
}
