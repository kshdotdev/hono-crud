/**
 * Cell — Field-level encryption across the whole write/read lifecycle.
 *
 * TARGET contract (pinned here; core/src/endpoints/base.ts `encryptOnWrite` /
 * `decryptOnRead` are the primitives): a model with `fieldEncryption` must
 * encrypt the configured field BEFORE it is persisted by EVERY write verb, and
 * decrypt it AFTER the adapter read on EVERY returning verb — exactly as the
 * create/update/read/list verbs already do.
 *
 * Two invariants, asserted per verb:
 *   1. ciphertext-at-rest — the raw stored value (read via
 *      `AdapterContext.inspectStoredField`, bypassing the adapter read path) is
 *      the `{ ct, iv, v }` envelope, never the plaintext. Before this PR,
 *      upsert / clone / batch-* / import / bulk-patch all leaked plaintext here.
 *   2. decrypted-on-return — the HTTP response body carries the plaintext, so a
 *      round trip is transparent to callers. Before this PR, search / export /
 *      restore / batch-restore / batch-delete returned ciphertext.
 *
 * Capability skip: legs without a JSON-capable column for the encrypted
 * envelope (prisma reuses the fixed examples `users` schema) skip LOUDLY via
 * the named `fieldEncryption` capability — never a silent green.
 */
import { isEncryptedValue } from 'hono-crud/encryption';
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  type UpsertEnvelope,
  createRecord,
  expectSuccess,
  jsonInit,
  readJson,
} from '../contract';
import { ENCRYPTED_FIELD } from '../model';

const BASE = '/enc-items';
const PLAINTEXT = 'super-secret-value-42';

/** A batch/import/search result item envelope wrapping a record in `data`/`item`. */
interface BatchListEnvelope<K extends string> {
  success: true;
  result: { [key in K]: ConformanceRecord[] } & { count: number };
}

/**
 * Normalizes a raw stored value into the object it represents at rest: memory
 * keeps the encrypted envelope as a live object; the drizzle JSON column
 * returns its JSON-string serialization. A non-JSON string (a leaked plaintext)
 * is returned unchanged so the envelope assertion fails cleanly rather than
 * throwing.
 */
function toStored(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

async function storedSecret(ctx: CtxGetter, id: string): Promise<unknown> {
  const inspect = ctx().inspectStoredField;
  if (!inspect) {
    throw new Error('inspectStoredField must be present on a fieldEncryption-capable leg');
  }
  return toStored(await inspect(id, ENCRYPTED_FIELD));
}

/** Asserts the field sits at rest as an encryption envelope, never plaintext. */
async function expectCiphertextAtRest(ctx: CtxGetter, id: string): Promise<void> {
  const stored = await storedSecret(ctx, id);
  expect(stored).not.toBe(PLAINTEXT);
  expect(isEncryptedValue(stored)).toBe(true);
}

async function seedEncrypted(
  ctx: CtxGetter,
  overrides: Record<string, unknown> = {},
): Promise<ConformanceRecord> {
  const { app } = ctx();
  const email = (overrides.email as string) ?? `enc-${crypto.randomUUID()}@conformance.test`;
  return createRecord(app, BASE, {
    name: 'Encrypted Person',
    role: 'user',
    age: 30,
    secret: PLAINTEXT,
    ...overrides,
    email,
  });
}

export function registerEncryptionCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  if (!descriptor.capabilities.fieldEncryption) {
    test.skip(`field encryption across write/read verbs [skipped: ${descriptor.name} has no JSON-capable column for the encrypted envelope]`, () => {});
    return;
  }

  // --------------------------------------------------------------------------
  // Control: create + read already encrypt/decrypt (the mirror the other
  // verbs are held to).
  // --------------------------------------------------------------------------
  test('create encrypts at rest; read decrypts on return (baseline mirror)', async () => {
    const { app } = ctx();
    const created = await seedEncrypted(ctx);
    expect(created.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, created.id);

    const read = await expectSuccess<ConformanceRecord>(
      await app.request(`${BASE}/${created.id}`),
      200,
    );
    expect(read.secret).toBe(PLAINTEXT);
  });

  // --------------------------------------------------------------------------
  // Write verbs — ciphertext at rest + decrypted response.
  // --------------------------------------------------------------------------
  test('upsert (create branch) encrypts at rest and returns plaintext', async () => {
    const { app } = ctx();
    const email = `upsert-new-${crypto.randomUUID()}@conformance.test`;
    const res = await app.request(
      `${BASE}/upsert`,
      jsonInit('POST', { name: 'Upsert New', email, role: 'user', age: 31, secret: PLAINTEXT }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<UpsertEnvelope<ConformanceRecord>>(res);
    expect(body.created).toBe(true);
    expect(body.result.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, body.result.id);
  });

  test('upsert (update branch) encrypts the new secret at rest and returns plaintext', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx, { email: `upsert-upd-${crypto.randomUUID()}@x.test` });
    const res = await app.request(
      `${BASE}/upsert`,
      jsonInit('POST', {
        name: 'Upsert Updated',
        email: seeded.email,
        role: 'user',
        age: 32,
        secret: PLAINTEXT,
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<UpsertEnvelope<ConformanceRecord>>(res);
    expect(body.created).toBe(false);
    expect(body.result.id).toBe(seeded.id);
    expect(body.result.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, seeded.id);
  });

  test('clone with a plaintext secret override encrypts at rest and returns plaintext', async () => {
    const { app } = ctx();
    const source = await seedEncrypted(ctx);
    const cloneEmail = `clone-${crypto.randomUUID()}@conformance.test`;
    const cloned = await expectSuccess<ConformanceRecord>(
      await app.request(
        `${BASE}/${source.id}/clone`,
        jsonInit('POST', { email: cloneEmail, secret: PLAINTEXT }),
      ),
      201,
    );
    expect(cloned.secret).toBe(PLAINTEXT);
    expect(cloned.id).not.toBe(source.id);
    await expectCiphertextAtRest(ctx, cloned.id);
  });

  test('batchCreate encrypts each row at rest and returns plaintext', async () => {
    const { app } = ctx();
    const res = await app.request(
      `${BASE}/batch`,
      jsonInit('POST', {
        items: [
          { name: 'BC One', email: `bc1-${crypto.randomUUID()}@x.test`, secret: PLAINTEXT },
          { name: 'BC Two', email: `bc2-${crypto.randomUUID()}@x.test`, secret: PLAINTEXT },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<BatchListEnvelope<'created'>>(res);
    expect(body.result.created).toHaveLength(2);
    for (const rec of body.result.created) {
      expect(rec.secret).toBe(PLAINTEXT);
      await expectCiphertextAtRest(ctx, rec.id);
    }
  });

  test('batchUpdate encrypts the updated secret at rest and returns plaintext', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx, { secret: 'old-secret' });
    const res = await app.request(
      `${BASE}/batch`,
      jsonInit('PATCH', { items: [{ id: seeded.id, data: { secret: PLAINTEXT } }] }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<BatchListEnvelope<'updated'>>(res);
    expect(body.result.updated).toHaveLength(1);
    expect(body.result.updated[0]?.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, seeded.id);
  });

  test('batchUpsert encrypts each row at rest and returns plaintext (bare-array body)', async () => {
    const { app } = ctx();
    const email = `bu-${crypto.randomUUID()}@x.test`;
    const res = await app.request(
      `${BASE}/batch/upsert`,
      jsonInit('POST', [{ name: 'BU One', email, role: 'user', age: 33, secret: PLAINTEXT }]),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      success: true;
      result: { items: Array<{ data: ConformanceRecord; created: boolean }> };
    }>(res);
    expect(body.result.items).toHaveLength(1);
    const item = body.result.items[0]!;
    expect(item.data.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, item.data.id);
  });

  test('import (create mode) encrypts each row at rest and read decrypts', async () => {
    const { app } = ctx();
    const email = `import-${crypto.randomUUID()}@x.test`;
    const res = await app.request(
      `${BASE}/import`,
      jsonInit('POST', {
        items: [{ name: 'Imported', email, role: 'user', age: 34, secret: PLAINTEXT }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      success: true;
      result: { results: Array<{ status: string; data?: ConformanceRecord }> };
    }>(res);
    const row = body.result.results[0]!;
    expect(row.status).toBe('created');
    const id = row.data!.id;
    expect(row.data!.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, id);

    const read = await expectSuccess<ConformanceRecord>(await app.request(`${BASE}/${id}`), 200);
    expect(read.secret).toBe(PLAINTEXT);
  });

  test('bulkPatch encrypts the patched secret at rest and returns plaintext', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx, { role: 'guest', secret: 'old-secret' });
    const res = await app.request(
      `${BASE}/bulk?role=guest`,
      jsonInit('PATCH', { secret: PLAINTEXT }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      success: true;
      updated: number;
      records?: ConformanceRecord[];
    }>(res);
    expect(body.updated).toBe(1);
    expect(body.records?.[0]?.secret).toBe(PLAINTEXT);
    await expectCiphertextAtRest(ctx, seeded.id);
  });

  // --------------------------------------------------------------------------
  // Returning verbs — decrypted on the way out.
  // --------------------------------------------------------------------------
  test('list decrypts each record on return', async () => {
    const { app } = ctx();
    await seedEncrypted(ctx);
    const body = await readJson<{ success: true; result: ConformanceRecord[] }>(
      await app.request(BASE),
    );
    expect(body.result.length).toBeGreaterThan(0);
    for (const rec of body.result) {
      expect(rec.secret).toBe(PLAINTEXT);
    }
  });

  test('search decrypts each hit on return', async () => {
    const { app } = ctx();
    await seedEncrypted(ctx, { name: 'Searchable Secret' });
    const body = await readJson<{
      success: true;
      result: Array<{ item: ConformanceRecord }>;
    }>(await app.request(`${BASE}/search?q=Searchable`));
    expect(body.result.length).toBeGreaterThan(0);
    for (const hit of body.result) {
      expect(hit.item.secret).toBe(PLAINTEXT);
    }
  });

  test('export (json) decrypts each record on return', async () => {
    const { app } = ctx();
    await seedEncrypted(ctx);
    const res = await app.request(`${BASE}/export?format=json`);
    expect(res.status).toBe(200);
    const body = await readJson<{
      success: true;
      result: { data: ConformanceRecord[] };
    }>(res);
    expect(body.result.data.length).toBeGreaterThan(0);
    for (const rec of body.result.data) {
      expect(rec.secret).toBe(PLAINTEXT);
    }
  });

  test('restore decrypts on return', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx);
    expect((await app.request(`${BASE}/${seeded.id}`, { method: 'DELETE' })).status).toBe(200);
    const restored = await expectSuccess<ConformanceRecord>(
      await app.request(`${BASE}/${seeded.id}/restore`, { method: 'POST' }),
      200,
    );
    expect(restored.secret).toBe(PLAINTEXT);
  });

  test('batchRestore decrypts each restored record on return', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx);
    expect((await app.request(`${BASE}/${seeded.id}`, { method: 'DELETE' })).status).toBe(200);
    const res = await app.request(`${BASE}/batch/restore`, jsonInit('POST', { ids: [seeded.id] }));
    expect(res.status).toBe(200);
    const body = await readJson<BatchListEnvelope<'restored'>>(res);
    expect(body.result.restored).toHaveLength(1);
    expect(body.result.restored[0]?.secret).toBe(PLAINTEXT);
  });

  test('batchDelete decrypts each deleted record on return', async () => {
    const { app } = ctx();
    const seeded = await seedEncrypted(ctx);
    const res = await app.request(`${BASE}/batch`, jsonInit('DELETE', { ids: [seeded.id] }));
    expect(res.status).toBe(200);
    const body = await readJson<BatchListEnvelope<'deleted'>>(res);
    expect(body.result.deleted).toHaveLength(1);
    expect(body.result.deleted[0]?.secret).toBe(PLAINTEXT);
  });
}
