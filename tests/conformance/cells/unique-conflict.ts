/**
 * Cell 6 — Unique-conflict contract: duplicate unique email on create → 409.
 *
 * Detection is centralized in core (`mapUniqueViolation`, managed-fields.ts:
 * SQLITE_CONSTRAINT / 23505 / P2002 / ER_DUP_ENTRY + message regex → 409
 * ConflictException), but each adapter must actually surface its driver's
 * violation through that mapper.
 *
 * Capability skip: the memory adapter has no constraint surface and the
 * framework has no model-level unique declaration, so it genuinely cannot
 * detect duplicates — skipped LOUDLY via the named capability below, never
 * silently green.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type CtxGetter,
  createRecord,
  expectError,
  expectList,
  jsonInit,
} from '../contract';

export function registerUniqueConflictCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  const supported = descriptor.capabilities.uniqueConstraints;

  test.skipIf(!supported)(
    'unique conflict: duplicate email on create → exact 409 CONFLICT envelope [requires capability: uniqueConstraints]',
    async () => {
      const { app } = ctx();
      await createRecord(app, '/items', {
        name: 'Original',
        email: 'duplicate@conformance.test',
        role: 'user',
        age: 40,
      });

      await expectError(
        await app.request(
          '/items',
          jsonInit('POST', {
            name: 'Imitator',
            email: 'duplicate@conformance.test',
            role: 'user',
            age: 41,
          }),
        ),
        409,
        'CONFLICT',
      );

      // The conflicting create must not have written anything.
      const list = await expectList(await app.request('/items?withDeleted=true'));
      const matches = list.result.filter((record) => record.email === 'duplicate@conformance.test');
      expect(matches).toHaveLength(1);
      expect(matches[0]?.name).toBe('Original');
    },
  );
}
