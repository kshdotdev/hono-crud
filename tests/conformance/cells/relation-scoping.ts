/**
 * Cell — owner-scoped relation includes (`?include=parent`).
 *
 * The conformance model carries a self-relation (`parent` belongsTo via
 * `parentId`) whose `scope` ties it to the tenant + soft-delete columns. A parent
 * the caller may not read — another tenant's row, or a soft-deleted one — must be
 * omitted from the include (resolved to `null`), never leaked through a child the
 * caller CAN read. The filter is pushed into the adapter query (`fetchRelated`),
 * so this exercises each adapter's WHERE translation, not just the core net.
 *
 * Skipped (named) on the prisma leg: it reuses the fixed examples `users` schema,
 * which has no self-relation column.
 */
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  expectSuccess,
} from '../contract';

export function registerRelationScopingCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  const { headerName, tenantA, tenantB } = descriptor.tenant;
  const asTenant = (tenant: string): Record<string, string> => ({ [headerName]: tenant });

  const title =
    'relation include scoping (?include=parent): cross-tenant + soft-deleted parents resolve to null';

  if (!descriptor.capabilities.relationScoping) {
    test.skip(`${title} [skipped: ${descriptor.name} model has no self-relation]`, () => {});
    return;
  }

  const readParent = async (childId: string, tenant: string): Promise<unknown> => {
    const result = await expectSuccess<ConformanceRecord>(
      await ctx().app.request(`/tenant-items/${childId}?include=parent`, {
        headers: asTenant(tenant),
      }),
      200,
    );
    return result.parent;
  };

  test(title, async () => {
    const { app } = ctx();

    // A parent owned by tenant B.
    const parentB = await createRecord(
      app,
      '/tenant-items',
      { name: 'Parent B', email: 'rel-parent-b@conformance.test', role: 'user', age: 40 },
      asTenant(tenantB),
    );

    // A child owned by tenant A pointing at tenant B's parent (cross-tenant FK).
    const childCross = await createRecord(
      app,
      '/tenant-items',
      {
        name: 'Child cross',
        email: 'rel-child-cross@conformance.test',
        role: 'user',
        age: 10,
        parentId: parentB.id,
      },
      asTenant(tenantA),
    );

    // Tenant A's include must NOT expose tenant B's parent.
    expect(await readParent(childCross.id, tenantA)).toBeNull();

    // A same-tenant parent IS embedded.
    const parentA = await createRecord(
      app,
      '/tenant-items',
      { name: 'Parent A', email: 'rel-parent-a@conformance.test', role: 'user', age: 41 },
      asTenant(tenantA),
    );
    const childSame = await createRecord(
      app,
      '/tenant-items',
      {
        name: 'Child same',
        email: 'rel-child-same@conformance.test',
        role: 'user',
        age: 11,
        parentId: parentA.id,
      },
      asTenant(tenantA),
    );
    expect((await readParent(childSame.id, tenantA)) as ConformanceRecord | null).toMatchObject({
      id: parentA.id,
    });

    // Soft-delete the parent → now omitted from the include (deletedAt IS NULL).
    await app.request(`/tenant-items/${parentA.id}`, {
      method: 'DELETE',
      headers: asTenant(tenantA),
    });
    expect(await readParent(childSame.id, tenantA)).toBeNull();
  });
}
