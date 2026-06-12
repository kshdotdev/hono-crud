/**
 * Cell 8 — Finalize pipeline parity across record-returning verbs.
 *
 * The finalize model variant declares:
 * - `serializationProfile: { exclude: ['age'] }` — `age` must never appear
 *   in a response, and
 * - a computed field `nameUpper` — must always appear.
 *
 * Both must hold IDENTICALLY on create, read, list, batchCreate, and
 * batchDelete responses (batchDelete previously skipped the shared
 * finalize chain — audit finding 44).
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type BatchCreateResult,
  type BatchDeleteResult,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectList,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';

function expectFinalized(record: ConformanceRecord, expectedName: string): void {
  expect(record.name).toBe(expectedName);
  expect(record.nameUpper).toBe(expectedName.toUpperCase());
  // The serialization profile must strip the field entirely, not null it.
  expect('age' in record).toBe(false);
}

export function registerFinalizePipelineCells(
  _descriptor: AdapterDescriptor,
  ctx: CtxGetter,
): void {
  test('finalize pipeline: computed field + profile omission are identical on create/read/list/batchCreate/batchDelete', async () => {
    const { app } = ctx();

    // create
    const created = await createRecord(app, '/finalize-items', {
      name: 'Widget One',
      email: 'widget1@conformance.test',
      role: 'user',
      age: 21,
    });
    expectFinalized(created, 'Widget One');

    // read
    const read = await expectSuccess<ConformanceRecord>(
      await app.request(`/finalize-items/${created.id}`),
      200,
    );
    expectFinalized(read, 'Widget One');

    // batchCreate
    const batchResponse = await app.request(
      '/finalize-items/batch',
      jsonInit('POST', {
        items: [
          { name: 'Widget Two', email: 'widget2@conformance.test', role: 'user', age: 22 },
          { name: 'Widget Three', email: 'widget3@conformance.test', role: 'user', age: 23 },
        ],
      }),
    );
    expect(batchResponse.status).toBe(201);
    const batchBody = await readJson<{
      success: true;
      result: BatchCreateResult<ConformanceRecord>;
    }>(batchResponse);
    expect(batchBody.success).toBe(true);
    expect(batchBody.result.count).toBe(2);
    expect(batchBody.result.created).toHaveLength(2);
    const byEmail = new Map(batchBody.result.created.map((record) => [record.email, record]));
    expectFinalized(byEmail.get('widget2@conformance.test') as ConformanceRecord, 'Widget Two');
    expectFinalized(byEmail.get('widget3@conformance.test') as ConformanceRecord, 'Widget Three');

    // list
    const list = await expectList(await app.request('/finalize-items'));
    expect(list.result).toHaveLength(3);
    const expectedNames = new Map([
      ['widget1@conformance.test', 'Widget One'],
      ['widget2@conformance.test', 'Widget Two'],
      ['widget3@conformance.test', 'Widget Three'],
    ]);
    for (const record of list.result) {
      expectFinalized(record, expectedNames.get(record.email) as string);
    }

    // batchDelete (finding 44: must run the same finalize chain)
    const idsToDelete = batchBody.result.created.map((record) => record.id);
    const deleteResponse = await app.request(
      '/finalize-items/batch',
      jsonInit('DELETE', { ids: idsToDelete }),
    );
    expect(deleteResponse.status).toBe(200);
    const deleteBody = await readJson<{
      success: true;
      result: BatchDeleteResult<ConformanceRecord>;
    }>(deleteResponse);
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.result.count).toBe(2);
    expect(deleteBody.result.deleted).toHaveLength(2);
    const deletedByEmail = new Map(
      deleteBody.result.deleted.map((record) => [record.email, record]),
    );
    expectFinalized(
      deletedByEmail.get('widget2@conformance.test') as ConformanceRecord,
      'Widget Two',
    );
    expectFinalized(
      deletedByEmail.get('widget3@conformance.test') as ConformanceRecord,
      'Widget Three',
    );
  });
}
