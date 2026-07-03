/**
 * Task 13 (PR-B) — encrypted-field consistency across audit, version-history,
 * subscribe/event payloads.
 *
 * Owner-approved contract: for a model with `fieldEncryption`, every downstream
 * data pipeline that carries a record SNAPSHOT must carry PLAINTEXT for the
 * encrypted field, uniform with the create/update/read verbs — while the row at
 * rest AND the version-history snapshot at rest stay ciphertext.
 *
 *   1. audit inputs (single delete / update-previous / upsert-previous) are
 *      plaintext (batch verbs already are).
 *   2. event `previousData` (delete/update) is plaintext -> subscribe relays it.
 *   3. version read / history decrypt `.data` on return.
 *   4. version compare decrypts BOTH sides before diffing: two versions with the
 *      same plaintext but different IVs show NO diff for that field.
 *   5. rollback writes the historical ciphertext verbatim (no double-encryption):
 *      the field at rest is valid ciphertext decrypting to the historical
 *      plaintext, never the stringified `{ ct, iv, v }` envelope.
 */
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryUpdateEndpoint,
  MemoryUpsertEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionRollbackEndpoint,
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { Hono } from 'hono';
import { defineMeta, defineModel } from 'hono-crud';
import {
  MemoryAuditLogStorage,
  setAuditStorage,
} from 'hono-crud/audit';
import {
  type EncryptedValue,
  StaticKeyProvider,
  decryptValue,
  isEncryptedValue,
} from 'hono-crud/encryption';
import { CrudEventEmitter, type CrudEventPayload, setEventEmitter } from 'hono-crud/events';
import { MemoryVersioningStorage, setVersioningStorage } from 'hono-crud/versioning';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const KEY = 'tKxYshdHC+/f7GSqpsQg7bGzSC6RpJ/E9TSmq0jB6TQ=';
const keyProvider = new StaticKeyProvider(KEY, 'enc-consistency-key');

const SecretSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  secret: z.string().nullable().optional(),
  version: z.number().default(1),
  deletedAt: z.string().nullable().optional(),
});

const SecretModel = defineModel({
  tableName: 'secret_docs',
  schema: SecretSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  versioning: { field: 'version', trackChangedBy: true, excludeFields: ['deletedAt'] },
  audit: {
    actions: ['create', 'update', 'delete', 'upsert'],
    trackChanges: true,
    storeRecord: true,
    storePreviousRecord: true,
    excludeFields: [],
  },
  fieldEncryption: { fields: ['secret'], keyProvider },
});
const secretMeta = defineMeta({ model: SecretModel });

class SecretCreate extends MemoryCreateEndpoint {
  _meta = secretMeta;
}
class SecretUpdate extends MemoryUpdateEndpoint {
  _meta = secretMeta;
}
class SecretDelete extends MemoryDeleteEndpoint {
  _meta = secretMeta;
}
class SecretUpsert extends MemoryUpsertEndpoint {
  _meta = secretMeta;
  protected override upsertKeys = ['email'];
}
class SecretVersionHistory extends MemoryVersionHistoryEndpoint {
  _meta = secretMeta;
}
class SecretVersionRead extends MemoryVersionReadEndpoint {
  _meta = secretMeta;
}
class SecretVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = secretMeta;
}
class SecretVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = secretMeta;
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    const status = ('status' in err && typeof err.status === 'number' ? err.status : 500) as
      | 400
      | 404
      | 500;
    return c.json(
      { success: false, error: { code: (err as { code?: string }).code ?? 'ERROR', message: err.message } },
      status,
    );
  });
  const mount = (ctor: new () => { setContext(c: unknown): void; handle(): Promise<Response> }) => {
    return async (c: Parameters<Parameters<typeof app.get>[1]>[0]) => {
      const ep = new ctor();
      ep.setContext(c);
      return ep.handle();
    };
  };
  app.post('/docs', mount(SecretCreate));
  app.patch('/docs/:id', mount(SecretUpdate));
  app.delete('/docs/:id', mount(SecretDelete));
  app.post('/docs/upsert', mount(SecretUpsert));
  app.get('/docs/:id/versions/compare', mount(SecretVersionCompare));
  app.get('/docs/:id/versions', mount(SecretVersionHistory));
  app.get('/docs/:id/versions/:version', mount(SecretVersionRead));
  app.post('/docs/:id/versions/:version/rollback', mount(SecretVersionRollback));
  return app;
}

/** Lets fire-and-forget audit/event writes settle (no waitUntil in test env). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

interface Rec {
  id: string;
  secret?: string | null;
  version: number;
  [k: string]: unknown;
}

async function createDoc(app: Hono, body: Record<string, unknown>): Promise<Rec> {
  const res = await app.request('/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { result: Rec }).result;
}

async function updateDoc(app: Hono, id: string, body: Record<string, unknown>): Promise<Rec> {
  const res = await app.request(`/docs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json() as { result: Rec }).result;
}

describe('encrypted-field consistency: audit + version-history + events', () => {
  let audit: MemoryAuditLogStorage;
  let versions: MemoryVersioningStorage;
  let emitter: CrudEventEmitter;
  let events: CrudEventPayload[];

  beforeEach(() => {
    clearStorage();
    audit = new MemoryAuditLogStorage();
    setAuditStorage(audit);
    versions = new MemoryVersioningStorage();
    setVersioningStorage(versions);
    emitter = new CrudEventEmitter();
    events = [];
    emitter.onTable('secret_docs', (e) => {
      events.push(e);
    });
    setEventEmitter(emitter);
  });

  // ---- Audit: single verbs record plaintext ------------------------------
  it('single delete audits PLAINTEXT previousRecord', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'D', email: 'd@x.test', secret: 'top-secret' });
    // at rest is ciphertext
    const store = getStore<Rec>('secret_docs');
    expect(isEncryptedValue(store.get(doc.id)?.secret)).toBe(true);

    const del = await app.request(`/docs/${doc.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    await settle();

    const log = audit.getAllLogs().find((l) => l.action === 'delete');
    expect(log).toBeDefined();
    expect(log?.previousRecord?.secret).toBe('top-secret');
  });

  it('single update audits PLAINTEXT previousRecord and plaintext change values', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'U', email: 'u@x.test', secret: 'old-secret' });
    await settle();
    await updateDoc(app, doc.id, { secret: 'new-secret' });
    await settle();

    const log = audit.getAllLogs().find((l) => l.action === 'update');
    expect(log).toBeDefined();
    expect(log?.previousRecord?.secret).toBe('old-secret');
    expect(log?.record?.secret).toBe('new-secret');
    const secretChange = log?.changes?.find((c) => c.field === 'secret');
    expect(secretChange).toBeDefined();
    expect(secretChange?.oldValue).toBe('old-secret');
    expect(secretChange?.newValue).toBe('new-secret');
  });

  it('upsert (update branch) audits PLAINTEXT previousRecord', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'Up', email: 'up@x.test', secret: 'pre-secret' });
    await settle();
    const res = await app.request('/docs/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Up2', email: 'up@x.test', secret: 'post-secret' }),
    });
    expect(res.status).toBe(200);
    await settle();

    const log = audit.getAllLogs().find((l) => l.action === 'upsert');
    expect(log).toBeDefined();
    expect(log?.previousRecord?.secret).toBe('pre-secret');
    expect(doc.id).toBeTruthy();
  });

  // ---- Events: previousData plaintext (subscribe relays these) ------------
  it('delete event carries PLAINTEXT previousData', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'DE', email: 'de@x.test', secret: 'del-secret' });
    await settle();
    events.length = 0;
    await app.request(`/docs/${doc.id}`, { method: 'DELETE' });
    await settle();

    const ev = events.find((e) => e.type === 'deleted');
    expect(ev).toBeDefined();
    expect((ev?.previousData as Rec | undefined)?.secret).toBe('del-secret');
  });

  it('update event carries PLAINTEXT previousData and data', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'UE', email: 'ue@x.test', secret: 'ue-old' });
    await settle();
    events.length = 0;
    await updateDoc(app, doc.id, { secret: 'ue-new' });
    await settle();

    const ev = events.find((e) => e.type === 'updated');
    expect(ev).toBeDefined();
    expect((ev?.previousData as Rec | undefined)?.secret).toBe('ue-old');
    expect((ev?.data as Rec | undefined)?.secret).toBe('ue-new');
  });

  // ---- Version-history returning endpoints decrypt on return -------------
  it('version read + history return PLAINTEXT snapshots', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'V', email: 'v@x.test', secret: 'v1-secret' });
    await updateDoc(app, doc.id, { secret: 'v2-secret' });

    // The version-1 snapshot at rest is ciphertext.
    const stored = versions.getAllVersions().find((v) => v.version === 1);
    expect(isEncryptedValue(stored?.data.secret)).toBe(true);

    const readRes = await app.request(`/docs/${doc.id}/versions/1`);
    expect(readRes.status).toBe(200);
    const read = (await readRes.json()) as { result: { data: { secret: string } } };
    expect(read.result.data.secret).toBe('v1-secret');

    const histRes = await app.request(`/docs/${doc.id}/versions`);
    const hist = (await histRes.json()) as {
      result: { versions: Array<{ data: { secret: string } }> };
    };
    expect(hist.result.versions.length).toBeGreaterThan(0);
    for (const v of hist.result.versions) {
      expect(isEncryptedValue(v.data.secret)).toBe(false);
    }
  });

  // ---- Version compare: same plaintext, different IV => NO diff ----------
  it('version compare shows NO secret diff when plaintext is identical across IVs', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'C', email: 'c@x.test', secret: 'same' });
    await updateDoc(app, doc.id, { secret: 'same' }); // re-encrypt same plaintext (new IV) -> v1 snapshot
    await updateDoc(app, doc.id, { secret: 'changed' }); // -> v2 snapshot (still plaintext 'same')

    const v1 = versions.getAllVersions().find((v) => v.version === 1);
    const v2 = versions.getAllVersions().find((v) => v.version === 2);
    // Confirm the at-rest ciphertext IVs actually differ (spurious-diff trap).
    expect((v1?.data.secret as EncryptedValue).iv).not.toBe((v2?.data.secret as EncryptedValue).iv);

    const res = await app.request(`/docs/${doc.id}/versions/compare?from=1&to=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { changes: Array<{ field: string }> };
    };
    expect(body.result.changes.find((c) => c.field === 'secret')).toBeUndefined();
  });

  it('version compare shows a secret diff when plaintext actually changed', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'C2', email: 'c2@x.test', secret: 'alpha' });
    await updateDoc(app, doc.id, { secret: 'beta' }); // v1 snapshot: alpha
    await updateDoc(app, doc.id, { secret: 'gamma' }); // v2 snapshot: beta

    const res = await app.request(`/docs/${doc.id}/versions/compare?from=1&to=2`);
    const body = (await res.json()) as {
      result: { changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> };
    };
    const change = body.result.changes.find((c) => c.field === 'secret');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('alpha');
    expect(change?.newValue).toBe('beta');
  });

  // ---- Rollback: at-rest ciphertext integrity (no double-encryption) -----
  it('rollback writes valid historical ciphertext at rest (no double-encryption)', async () => {
    const app = buildApp();
    const doc = await createDoc(app, { name: 'R', email: 'r@x.test', secret: 'roll-1' });
    await updateDoc(app, doc.id, { secret: 'roll-2' }); // v1 snapshot: roll-1

    const res = await app.request(`/docs/${doc.id}/versions/1/rollback`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { secret: string } };
    expect(body.result.secret).toBe('roll-1');

    // At rest: valid ciphertext envelope that decrypts to the historical plaintext,
    // NOT the stringified "[object Object]" of a double-encrypted envelope.
    const store = getStore<Rec>('secret_docs');
    const atRest = store.get(doc.id)?.secret;
    expect(isEncryptedValue(atRest)).toBe(true);
    const decrypted = await decryptValue(atRest as EncryptedValue, keyProvider);
    expect(decrypted).toBe('roll-1');
  });
});
