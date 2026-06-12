/**
 * Cell 5 — Managed fields: id generation + createdAt/updatedAt semantics.
 *
 * Contract (representation is capability-declared, semantics identical):
 * - `id` is generated per the model's strategy (uuid default here) and
 *   returned on create.
 * - `createdAt` and `updatedAt` are both set on create.
 * - Update bumps `updatedAt` strictly and never touches `createdAt`.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  UUID_V4,
  createRecord,
  expectSuccess,
  jsonInit,
  sleep,
  timestampToMillis,
} from '../contract';

export function registerManagedFieldCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  const kind = descriptor.capabilities.timestampKind;

  test(`managed fields: create sets uuid id + createdAt/updatedAt (${kind})`, async () => {
    const { app } = ctx();
    const created = await createRecord(app, '/items', {
      name: 'Managed',
      email: 'managed@conformance.test',
      role: 'user',
      age: 33,
    });

    expect(created.id).toMatch(UUID_V4);

    const createdAt = timestampToMillis(created.createdAt, kind);
    const updatedAt = timestampToMillis(created.updatedAt, kind);
    // Sanity: a real recent timestamp, not a zero value or garbage.
    expect(createdAt).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
    expect(updatedAt).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
  });

  test('managed fields: update bumps updatedAt strictly and leaves createdAt untouched', async () => {
    const { app } = ctx();
    const created = await createRecord(app, '/items', {
      name: 'Before Bump',
      email: 'bump@conformance.test',
      role: 'user',
      age: 34,
    });

    // Ensure the clock can advance past epoch-ms resolution.
    await sleep(15);

    const updated = await expectSuccess<ConformanceRecord>(
      await app.request(`/items/${created.id}`, jsonInit('PATCH', { name: 'After Bump' })),
      200,
    );

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('After Bump');
    expect(updated.createdAt).toEqual(created.createdAt);
    expect(timestampToMillis(updated.updatedAt, kind)).toBeGreaterThan(
      timestampToMillis(created.updatedAt, kind),
    );
  });
}
