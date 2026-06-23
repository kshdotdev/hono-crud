/**
 * Cell — batch owner-scoping (`batchDelete` / `batchUpdate` / `batchRestore`).
 *
 * The single-row verbs get their tenant filter from core-injected
 * `additionalFilters`, but the batch verbs operate on a client-supplied id list
 * and so must constrain it themselves: core enforces tenant presence
 * (`validateTenantId`) and each adapter ANDs the tenant equality into its WHERE
 * (`getTenantScopeFilter`). The contract: a tenant can never delete / update /
 * restore another tenant's row by id — the foreign id falls through to
 * `notFound`, the row is untouched, and the caller's own ids still succeed.
 *
 * Skipped (named) on the prisma leg: its tenant variant reuses the fixed
 * examples schema and registers no batch verbs.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectError,
  expectList,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';

interface BatchOpResult {
  success: true;
  result: {
    count: number;
    notFound?: string[];
    deleted?: ConformanceRecord[];
    updated?: ConformanceRecord[];
    restored?: ConformanceRecord[];
  };
}

export function registerBatchTenantScopingCells(
  descriptor: AdapterDescriptor,
  ctx: CtxGetter,
): void {
  const { headerName, tenantA, tenantB } = descriptor.tenant;
  const asTenant = (tenant: string): Record<string, string> => ({ [headerName]: tenant });

  const title =
    'batch owner-scoping: tenant B cannot batchDelete/batchUpdate/batchRestore tenant A rows by id';

  if (!descriptor.capabilities.batchTenantScoping) {
    test.skip(`${title} [skipped: ${descriptor.name} registers no batch verbs on the tenant model]`, () => {});
    return;
  }

  test(title, async () => {
    const { app } = ctx();

    const recordA = await createRecord(
      app,
      '/tenant-items',
      { name: 'A Document', email: 'batch-tenant-a@conformance.test', role: 'user', age: 31 },
      asTenant(tenantA),
    );
    const recordB = await createRecord(
      app,
      '/tenant-items',
      { name: 'B Document', email: 'batch-tenant-b@conformance.test', role: 'user', age: 32 },
      asTenant(tenantB),
    );

    // --- batchDelete: tenant B targets A's id ---------------------------------
    const crossDelete = await readJson<BatchOpResult>(
      await app.request(
        '/tenant-items/batch',
        jsonInit('DELETE', { ids: [recordA.id] }, asTenant(tenantB)),
      ),
    );
    expect(crossDelete.result.count).toBe(0);
    expect(crossDelete.result.deleted).toEqual([]);
    expect(crossDelete.result.notFound).toEqual([recordA.id]);

    // A is untouched — tenant A still reads it, alive.
    const stillThere = await expectSuccess<ConformanceRecord>(
      await app.request(`/tenant-items/${recordA.id}`, { headers: asTenant(tenantA) }),
      200,
    );
    expect(stillThere.name).toBe('A Document');

    // --- batchUpdate: tenant B targets A's id ---------------------------------
    const crossUpdate = await readJson<BatchOpResult>(
      await app.request(
        '/tenant-items/batch',
        jsonInit(
          'PATCH',
          { items: [{ id: recordA.id, data: { name: 'Hijacked' } }] },
          asTenant(tenantB),
        ),
      ),
    );
    expect(crossUpdate.result.count).toBe(0);
    expect(crossUpdate.result.updated).toEqual([]);
    expect(crossUpdate.result.notFound).toEqual([recordA.id]);

    // A's name is unchanged.
    const reReadA = await expectSuccess<ConformanceRecord>(
      await app.request(`/tenant-items/${recordA.id}`, { headers: asTenant(tenantA) }),
      200,
    );
    expect(reReadA.name).toBe('A Document');

    // --- batchRestore: tenant B targets A's soft-deleted id -------------------
    // Tenant A soft-deletes its own row first.
    await app.request(`/tenant-items/${recordA.id}`, {
      method: 'DELETE',
      headers: asTenant(tenantA),
    });

    const crossRestore = await readJson<BatchOpResult>(
      await app.request(
        '/tenant-items/batch/restore',
        jsonInit('POST', { ids: [recordA.id] }, asTenant(tenantB)),
      ),
    );
    expect(crossRestore.result.count).toBe(0);
    expect(crossRestore.result.restored).toEqual([]);
    expect(crossRestore.result.notFound).toEqual([recordA.id]);

    // Still deleted for tenant A (positive control: A *can* restore its own row).
    await expectError(
      await app.request(`/tenant-items/${recordA.id}`, { headers: asTenant(tenantA) }),
      404,
      'NOT_FOUND',
    );
    const ownRestore = await readJson<BatchOpResult>(
      await app.request(
        '/tenant-items/batch/restore',
        jsonInit('POST', { ids: [recordA.id] }, asTenant(tenantA)),
      ),
    );
    expect(ownRestore.result.count).toBe(1);
    expect(ownRestore.result.restored).toHaveLength(1);

    // --- positive control: tenant B deletes its OWN row ----------------------
    const ownDelete = await readJson<BatchOpResult>(
      await app.request(
        '/tenant-items/batch',
        jsonInit('DELETE', { ids: [recordB.id] }, asTenant(tenantB)),
      ),
    );
    expect(ownDelete.result.count).toBe(1);
    expect(ownDelete.result.deleted).toHaveLength(1);

    // Tenant A's list is back to exactly its one (restored) row.
    const listA = await expectList(
      await app.request('/tenant-items', { headers: asTenant(tenantA) }),
    );
    expect(listA.result.map((record) => record.id)).toEqual([recordA.id]);
  });

  test('batch owner-scoping: batch request without the tenant header → 400 TENANT_REQUIRED', async () => {
    const { app } = ctx();
    await expectError(
      await app.request('/tenant-items/batch', jsonInit('DELETE', { ids: ['nonexistent'] })),
      400,
      'TENANT_REQUIRED',
    );
  });
}
