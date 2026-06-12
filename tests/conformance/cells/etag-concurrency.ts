/**
 * Cell 4 — ETag / If-Match optimistic concurrency.
 *
 * The logic is core-owned (`etagEnabled = true` on the read/update endpoint
 * classes; core/src/endpoints/read.ts + update.ts + utils/etag.ts), but the
 * adapter participates by supplying the row that gets hashed (read fetch and
 * update's `findExisting` snapshot). Running it per adapter guards against
 * an adapter bypassing the core pipeline or returning a divergent row shape
 * between its read and find-existing paths.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  ETAG_SHAPE,
  createRecord,
  expectError,
  expectSuccess,
  jsonInit,
} from '../contract';

export function registerEtagConcurrencyCells(_descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  test('ETag/If-Match: read exposes ETag, stale If-Match → 409 CONFLICT, current If-Match → 200', async () => {
    const { app } = ctx();
    const record = await createRecord(app, '/items', {
      name: 'Rev 1',
      email: 'etag@conformance.test',
      role: 'user',
      age: 20,
    });

    // Read exposes a well-formed ETag header.
    const read1 = await app.request(`/items/${record.id}`);
    expect(read1.status).toBe(200);
    const etag1 = read1.headers.get('ETag');
    expect(etag1).toMatch(ETAG_SHAPE);

    // Conditional GET: If-None-Match with the current ETag → 304, no body.
    const conditional = await app.request(`/items/${record.id}`, {
      headers: { 'If-None-Match': etag1 as string },
    });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('ETag')).toBe(etag1);

    // Unconditional update succeeds and re-stamps a NEW ETag.
    const update1 = await app.request(`/items/${record.id}`, jsonInit('PATCH', { name: 'Rev 2' }));
    const updated1 = await expectSuccess<ConformanceRecord>(update1, 200);
    expect(updated1.name).toBe('Rev 2');
    const etag2 = update1.headers.get('ETag');
    expect(etag2).toMatch(ETAG_SHAPE);
    expect(etag2).not.toBe(etag1);

    // Stale If-Match (the pre-update ETag) → exact 409 CONFLICT envelope.
    await expectError(
      await app.request(
        `/items/${record.id}`,
        jsonInit('PATCH', { name: 'Rev 3' }, { 'If-Match': etag1 as string }),
      ),
      409,
      'CONFLICT',
    );

    // The stale update must not have been applied.
    const afterConflict = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${record.id}`),
      200,
    );
    expect(afterConflict.name).toBe('Rev 2');

    // Current If-Match (fresh ETag from a re-read) → 200 and applies.
    const read2 = await app.request(`/items/${record.id}`);
    expect(read2.status).toBe(200);
    const etag3 = read2.headers.get('ETag');
    expect(etag3).toMatch(ETAG_SHAPE);

    const update2 = await app.request(
      `/items/${record.id}`,
      jsonInit('PATCH', { name: 'Rev 3' }, { 'If-Match': etag3 as string }),
    );
    const updated2 = await expectSuccess<ConformanceRecord>(update2, 200);
    expect(updated2.name).toBe('Rev 3');
  });
}
