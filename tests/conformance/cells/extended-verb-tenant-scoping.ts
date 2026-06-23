/**
 * Cell — extended-verb owner-scoping (`aggregate` / `search` / `export` /
 * `bulkPatch`).
 *
 * These four verbs build their WHERE clause from a parsed filter set (a
 * `ListFilters` for search/export/bulkPatch, an `AggregateOptions.filters`
 * record for aggregate) rather than from a client-supplied id list. Unlike the
 * single-row verbs they do NOT receive a core-injected `additionalFilters`, and
 * unlike List they used to run their handler without re-applying the tenant
 * scope at all — so each could read, aggregate, or mutate across every tenant.
 *
 * The contract under test (core `applyTenantScope` / `applyTenantScopeToAggregateFilters`):
 *   - aggregate counts only the caller's rows,
 *   - search never returns another tenant's rows,
 *   - export never includes another tenant's rows,
 *   - bulkPatch never matches or mutates another tenant's rows,
 *   - and each verb 400s with TENANT_REQUIRED when the tenant is absent.
 *
 * Skipped (named) on the prisma leg: its tenant variant reuses the fixed
 * examples schema and registers none of these verbs.
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
  readJson,
} from '../contract';

interface AggregateCountResult {
  values: { count: number };
}

interface AggregateGroupResult {
  groups: Array<{ key: Record<string, unknown>; values: { count?: number } }>;
}

interface SearchEnvelope {
  success: true;
  result: Array<{ item: ConformanceRecord; score?: number }>;
}

interface ExportResult {
  data: ConformanceRecord[];
  count: number;
  format: string;
  exportedAt: string;
}

interface BulkPatchResponse {
  success: true;
  matched: number;
  updated: number;
  dryRun: boolean;
}

export function registerExtendedVerbTenantScopingCells(
  descriptor: AdapterDescriptor,
  ctx: CtxGetter,
): void {
  const { headerName, tenantA, tenantB } = descriptor.tenant;
  const asTenant = (tenant: string): Record<string, string> => ({ [headerName]: tenant });

  const title =
    'extended-verb owner-scoping: aggregate/search/export/bulkPatch never cross tenants';

  if (!descriptor.capabilities.extendedVerbTenantScoping) {
    test.skip(`${title} [skipped: ${descriptor.name} registers no aggregate/search/export/bulkPatch on the tenant model]`, () => {});
    return;
  }

  test(title, async () => {
    const { app } = ctx();

    // Tenant A: two rows (one `user`, one `admin`). Tenant B: one `user` row.
    await createRecord(
      app,
      '/tenant-items',
      { name: 'Alpha One', email: 'ev-a1@conformance.test', role: 'user', age: 10 },
      asTenant(tenantA),
    );
    await createRecord(
      app,
      '/tenant-items',
      { name: 'Alpha Two', email: 'ev-a2@conformance.test', role: 'admin', age: 20 },
      asTenant(tenantA),
    );
    await createRecord(
      app,
      '/tenant-items',
      { name: 'Bravo Solo', email: 'ev-b1@conformance.test', role: 'user', age: 30 },
      asTenant(tenantB),
    );

    // --- aggregate: COUNT(*) is per-tenant -----------------------------------
    const aggA = await expectSuccess<AggregateCountResult>(
      await app.request('/tenant-items/aggregate?count=*', { headers: asTenant(tenantA) }),
      200,
    );
    expect(aggA.values.count).toBe(2);

    const aggB = await expectSuccess<AggregateCountResult>(
      await app.request('/tenant-items/aggregate?count=*', { headers: asTenant(tenantB) }),
      200,
    );
    expect(aggB.values.count).toBe(1);

    // Grouped aggregation is per-tenant too (not just COUNT(*)): tenant A's
    // groups (one `user`, one `admin`) sum to its own two rows, never B's.
    const aggGroupA = await expectSuccess<AggregateGroupResult>(
      await app.request('/tenant-items/aggregate?count=*&groupBy=role', { headers: asTenant(tenantA) }),
      200,
    );
    expect(aggGroupA.groups.reduce((sum, group) => sum + (group.values.count ?? 0), 0)).toBe(2);

    // --- search: tenant B cannot find tenant A's rows ------------------------
    const searchBforA = await app.request('/tenant-items/search?q=Alpha', {
      headers: asTenant(tenantB),
    });
    expect(searchBforA.status).toBe(200);
    expect((await readJson<SearchEnvelope>(searchBforA)).result).toEqual([]);

    // Positive control: tenant A finds both of its own 'Alpha' rows.
    const searchAforA = await app.request('/tenant-items/search?q=Alpha', {
      headers: asTenant(tenantA),
    });
    expect(searchAforA.status).toBe(200);
    const aHits = await readJson<SearchEnvelope>(searchAforA);
    expect(aHits.result).toHaveLength(2);
    expect(aHits.result.every((hit) => hit.item.tenantId === tenantA)).toBe(true);

    // --- export: tenant B's export excludes tenant A's rows ------------------
    const exportB = await expectSuccess<ExportResult>(
      await app.request('/tenant-items/export?format=json', { headers: asTenant(tenantB) }),
      200,
    );
    expect(exportB.count).toBe(1);
    expect(exportB.data).toHaveLength(1);
    expect(exportB.data[0].email).toBe('ev-b1@conformance.test');
    expect(exportB.data.every((row) => row.tenantId === tenantB)).toBe(true);

    // --- bulkPatch: tenant B patching role=user does NOT touch A's user row --
    // Without owner-scoping, `?role=user` would match Alpha One AND Bravo Solo
    // (matched: 2). Scoped, it matches only tenant B's own row.
    const bulkB = await readJson<BulkPatchResponse>(
      await app.request(
        '/tenant-items/bulk?role=user',
        jsonInit('PATCH', { age: 99 }, asTenant(tenantB)),
      ),
    );
    expect(bulkB.matched).toBe(1);
    expect(bulkB.updated).toBe(1);

    // Tenant A is untouched: still two rows, and its `user` row keeps age 10.
    const aggAAfter = await expectSuccess<AggregateCountResult>(
      await app.request('/tenant-items/aggregate?count=*', { headers: asTenant(tenantA) }),
      200,
    );
    expect(aggAAfter.values.count).toBe(2);

    const aUserRow = await expectSuccess<ExportResult>(
      await app.request('/tenant-items/export?format=json', { headers: asTenant(tenantA) }),
      200,
    );
    const alphaOne = aUserRow.data.find((row) => row.email === 'ev-a1@conformance.test');
    expect(alphaOne?.age).toBe(10);
  });

  test('extended-verb owner-scoping: each verb without the tenant header → 400 TENANT_REQUIRED', async () => {
    const { app } = ctx();

    await expectError(await app.request('/tenant-items/aggregate?count=*'), 400, 'TENANT_REQUIRED');
    await expectError(await app.request('/tenant-items/search?q=Alpha'), 400, 'TENANT_REQUIRED');
    await expectError(
      await app.request('/tenant-items/export?format=json'),
      400,
      'TENANT_REQUIRED',
    );
    await expectError(
      await app.request('/tenant-items/bulk?role=user', jsonInit('PATCH', { age: 1 })),
      400,
      'TENANT_REQUIRED',
    );
  });

  test('extended-verb owner-scoping: search/export `?include=` never embeds another tenant`s related row', async () => {
    const { app } = ctx();

    // Tenant A owns a row; tenant B owns a row whose `parentId` POINTS AT A's row.
    const parentA = await createRecord(
      app,
      '/tenant-items',
      { name: 'Include Parent A', email: 'ev-inc-a@conformance.test', role: 'user', age: 50 },
      asTenant(tenantA),
    );
    await createRecord(
      app,
      '/tenant-items',
      {
        name: 'Include Child B',
        email: 'ev-inc-b@conformance.test',
        role: 'user',
        age: 51,
        parentId: parentA.id,
      },
      asTenant(tenantB),
    );

    // search?include=parent as tenant B: the parent belongs to tenant A, so the
    // owner-scoped include must resolve it to null — NOT embed A's row.
    const searchB = await app.request('/tenant-items/search?q=Child&include=parent', {
      headers: asTenant(tenantB),
    });
    expect(searchB.status).toBe(200);
    const searchHits = await readJson<SearchEnvelope>(searchB);
    expect(searchHits.result).toHaveLength(1);
    expect(searchHits.result[0].item.parent ?? null).toBeNull();

    // export?include=parent as tenant B: same — the foreign parent must not embed.
    const exportB = await expectSuccess<ExportResult>(
      await app.request('/tenant-items/export?format=json&include=parent', {
        headers: asTenant(tenantB),
      }),
      200,
    );
    const child = exportB.data.find((row) => row.email === 'ev-inc-b@conformance.test');
    expect(child?.parent ?? null).toBeNull();
  });
}
