import {
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionRollbackEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { Hono } from 'hono';
import { defineModel } from 'hono-crud';
import { multiTenant } from 'hono-crud/multi-tenant';
import { MemoryVersioningStorage, setVersioningStorage } from 'hono-crud/versioning';
/**
 * The version endpoints must honor multi-tenant owner-scope: a record in another
 * tenant is 404, so its version history / read / compare / rollback never leak
 * cross-tenant (regression test for the leak this fix closes).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const DocSchema = z.object({
  id: z.string(),
  title: z.string(),
  tenantId: z.string().optional(),
  version: z.number().default(1),
});

const DocModel = defineModel({
  tableName: 'scoped_docs',
  schema: DocSchema,
  primaryKeys: ['id'],
  multiTenant: { field: 'tenantId', source: 'context', contextKey: 'tenantId' },
  versioning: { field: 'version' },
});

class DocCreate extends MemoryCreateEndpoint {
  _meta = { model: DocModel };
}
class DocUpdate extends MemoryUpdateEndpoint {
  _meta = { model: DocModel };
}
class DocVersions extends MemoryVersionHistoryEndpoint {
  _meta = { model: DocModel };
}
class DocVersionRead extends MemoryVersionReadEndpoint {
  _meta = { model: DocModel };
}
class DocVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = { model: DocModel };
}
class DocVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = { model: DocModel };
}

const asA = { 'X-Tenant-ID': TENANT_A };
const asB = { 'X-Tenant-ID': TENANT_B };
const jsonA = { 'Content-Type': 'application/json', ...asA };

describe('version endpoints — multi-tenant owner scope', () => {
  let app: Hono;
  let docId: string;

  beforeEach(async () => {
    clearStorage();
    setVersioningStorage(new MemoryVersioningStorage());
    app = new Hono();
    app.onError((err, c) => {
      const status =
        'status' in err && typeof (err as { status?: number }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      return c.json(
        { success: false, error: { code: (err as { code?: string }).code ?? 'ERROR', message: err.message } },
        status as 400 | 404 | 500,
      );
    });
    app.use('/*', multiTenant({ contextKey: 'tenantId' }));
    app.post('/docs', async (c) => {
      const e = new DocCreate();
      e.setContext(c);
      return e.handle();
    });
    app.patch('/docs/:id', async (c) => {
      const e = new DocUpdate();
      e.setContext(c);
      return e.handle();
    });
    app.get('/docs/:id/versions/compare', async (c) => {
      const e = new DocVersionCompare();
      e.setContext(c);
      return e.handle();
    });
    app.get('/docs/:id/versions', async (c) => {
      const e = new DocVersions();
      e.setContext(c);
      return e.handle();
    });
    app.get('/docs/:id/versions/:version', async (c) => {
      const e = new DocVersionRead();
      e.setContext(c);
      return e.handle();
    });
    app.post('/docs/:id/versions/:version/rollback', async (c) => {
      const e = new DocVersionRollback();
      e.setContext(c);
      return e.handle();
    });

    // Tenant A creates + updates a doc → produces version-1 history.
    const created = await app.request('/docs', {
      method: 'POST',
      headers: jsonA,
      body: JSON.stringify({ id: 'doc-1', title: 'A v1' }),
    });
    docId = ((await created.json()) as { result: { id: string } }).result.id;
    await app.request(`/docs/${docId}`, {
      method: 'PATCH',
      headers: jsonA,
      body: JSON.stringify({ title: 'A v2' }),
    });
  });

  it('owner sees history; another tenant gets 404 (no leak)', async () => {
    const a = await app.request(`/docs/${docId}/versions`, { headers: asA });
    expect(a.status).toBe(200);
    const aBody = (await a.json()) as { result: { versions: unknown[] } };
    expect(aBody.result.versions.length).toBeGreaterThan(0);

    const b = await app.request(`/docs/${docId}/versions`, { headers: asB });
    expect(b.status).toBe(404);
  });

  it('read / compare / rollback are all owner-scoped (404 for another tenant)', async () => {
    expect((await app.request(`/docs/${docId}/versions/1`, { headers: asB })).status).toBe(404);
    expect(
      (await app.request(`/docs/${docId}/versions/compare?from=1&to=1`, { headers: asB })).status,
    ).toBe(404);
    expect(
      (await app.request(`/docs/${docId}/versions/1/rollback`, { method: 'POST', headers: asB }))
        .status,
    ).toBe(404);

    // Owner still has access.
    expect((await app.request(`/docs/${docId}/versions/1`, { headers: asA })).status).toBe(200);
  });
});
