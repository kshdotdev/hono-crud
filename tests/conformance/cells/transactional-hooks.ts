/**
 * Cell 10 — Transactional before/after hook pair.
 *
 * Two capability-declared contracts, both LOUD (assertable), never silent:
 * - 'rollback' (drizzle, prisma): with `useTransaction = true`, the hooks run
 *   inside a live transaction (`HookContext.db.tx` is set) and an after-hook
 *   throw rolls the parent write back.
 * - 'noop-sentinel' (memory): no transaction machinery; the documented
 *   contract is that `HookContext.db.tx` IS the frozen `MEMORY_NOOP_TX`
 *   sentinel (feature-detectable) and an after-hook throw does NOT roll the
 *   write back.
 *
 * `test.runIf` keeps the non-applicable variant visibly skipped per adapter.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectError,
  expectSuccess,
  jsonInit,
} from '../contract';

export function registerTransactionalHookCells(
  descriptor: AdapterDescriptor,
  ctx: CtxGetter,
): void {
  const mode = descriptor.capabilities.transactionalHooks;

  test('hooks: before/after pair observes a consistent record around the write', async () => {
    const { app, hookRecorder } = ctx();

    const created = await createRecord(app, '/hook-items', {
      name: 'Hooked',
      email: 'hooked@conformance.test',
      role: 'user',
      age: 20,
    });

    expect(hookRecorder.observations.map((o) => o.phase)).toEqual(['before', 'after']);
    const [before, after] = hookRecorder.observations;

    // The before-hook sees the validated input BEFORE managed fields are
    // applied at the adapter write site — no generated id yet.
    expect(before.data.id).toBeUndefined();
    expect(before.data.name).toBe('Hooked');
    expect(before.data.email).toBe('hooked@conformance.test');

    // The after-hook sees the persisted record, consistent with the response.
    expect(after.data.id).toBe(created.id);
    expect(after.data.name).toBe(created.name);
    expect(after.data.email).toBe(created.email);
  });

  test.runIf(mode === 'rollback')(
    'hooks: after-hook throw rolls back the parent write [capability: transactionalHooks=rollback]',
    async () => {
      const { app, hookRecorder } = ctx();
      hookRecorder.failAfter = true;

      const response = await app.request(
        '/hook-items',
        jsonInit('POST', {
          name: 'Doomed',
          email: 'doomed@conformance.test',
          role: 'user',
          age: 30,
        }),
      );
      expect(response.status).toBe(500);

      const after = hookRecorder.observations.find((o) => o.phase === 'after');
      expect(after).toBeDefined();
      // The hook pair must run inside a live transaction handle.
      expect(after?.tx).toBeDefined();

      // The parent INSERT was rolled back: the record does not exist.
      const id = String(after?.data.id);
      await expectError(await app.request(`/items/${id}`), 404, 'NOT_FOUND');
    },
  );

  test.runIf(mode === 'noop-sentinel')(
    'hooks: after-hook throw does NOT roll back, and the no-op tx sentinel is exposed loudly [capability: transactionalHooks=noop-sentinel]',
    async () => {
      const { app, hookRecorder } = ctx();
      hookRecorder.failAfter = true;

      const response = await app.request(
        '/hook-items',
        jsonInit('POST', {
          name: 'Persisted Anyway',
          email: 'persisted-anyway@conformance.test',
          role: 'user',
          age: 31,
        }),
      );
      expect(response.status).toBe(500);

      const after = hookRecorder.observations.find((o) => o.phase === 'after');
      expect(after).toBeDefined();
      // The documented LOUD contract: hooks can feature-detect the absence of
      // real transactions via the frozen sentinel on HookContext.db.tx.
      expect(descriptor.noopTxSentinel).toBeDefined();
      expect(after?.tx).toBe(descriptor.noopTxSentinel);

      // No rollback machinery exists: the write persisted.
      const id = String(after?.data.id);
      const persisted = await expectSuccess<ConformanceRecord>(
        await app.request(`/items/${id}`),
        200,
      );
      expect(persisted.name).toBe('Persisted Anyway');
    },
  );
}
