/**
 * Cell — CRUD event emission across the whole mutation-verb surface.
 *
 * TARGET contract (pinned here; core/src/endpoints/base.ts `emitEvent` /
 * `emitBatchEvents` are the primitives): every mutation verb must emit a CRUD
 * event through the resolved emitter, at the same lifecycle position the
 * create/update/delete/restore verbs already emit (right after the audit-log
 * call, before the finalize/serialize tail), wrapped in `runAfterResponse`.
 *
 * Two invariants, asserted per verb:
 *   1. right event name — each verb emits its declared `CrudEventType`
 *      (`upserted` / `cloned` / `imported` / `bulk_patched` / `batch_*`), one
 *      event PER affected record (the payload's `recordId`/`data` are singular,
 *      so batch verbs fan out per record exactly as `logBatchAudit` does).
 *      Before this PR upsert / clone / import / bulk-patch / batch-* emitted
 *      NOTHING — this cell was RED for all of them.
 *   2. decrypted record payload — the event carries the plaintext in-memory
 *      record (post-`decryptOnRead`), the same representation create/update
 *      carry, so a subscriber sees a uniform decrypted stream. The `secret`
 *      field in every payload must be the plaintext, never the at-rest envelope.
 *
 * Wiring: the conformance app injects no per-request emitter, so the cell
 * installs a fresh global emitter (`setEventEmitter`) per capture and resets it
 * afterwards (`eventEmitterRegistry.reset()`) — endpoints resolve it via the
 * global fallback. Emission runs synchronously inside `emit()` (the listener is
 * invoked before `emit`'s first await), so the collection array is populated by
 * the time the HTTP response resolves.
 *
 * Route coverage: exercised against `/enc-items`, the only route family in the
 * conformance app that mounts the COMPLETE mutation-verb set (create, update,
 * delete, restore, upsert, clone, import, batch-create/update/delete/restore/
 * upsert, bulk-patch). That family is registered only on encryption-capable
 * legs, so the prisma leg — which reuses the fixed examples `users` schema and
 * mounts no such set — skips LOUDLY via the named `fieldEncryption` capability,
 * never a silent green. Using the encrypted model doubles as proof of invariant
 * 2 (the payload carries plaintext).
 */
import {
  CrudEventEmitter,
  type CrudEventPayload,
  eventEmitterRegistry,
  setEventEmitter,
} from 'hono-crud/events';
import { expect, test } from 'vitest';
import {
  type AdapterDescriptor,
  type ConformanceRecord,
  type CtxGetter,
  createRecord,
  jsonInit,
  sleep,
} from '../contract';

const BASE = '/enc-items';
const PLAINTEXT = 'super-secret-value-42';

/**
 * Installs a fresh global emitter, runs `fn`, and returns every event the
 * emitter saw. Resets the global afterwards so sibling cells (which configure
 * no emitter) keep seeing `resolveEventEmitter() === null`.
 */
async function captureEvents(fn: () => Promise<void>): Promise<CrudEventPayload[]> {
  const collected: CrudEventPayload[] = [];
  const emitter = new CrudEventEmitter();
  emitter.onAny((event) => {
    collected.push(event);
  });
  setEventEmitter(emitter);
  try {
    await fn();
    // Emission is synchronous relative to the response, but flush a macrotask
    // to be robust against any adapter that defers work behind an await.
    await sleep(0);
  } finally {
    eventEmitterRegistry.reset();
  }
  return collected;
}

function ofType(events: CrudEventPayload[], type: string): CrudEventPayload[] {
  return events.filter((event) => event.type === type);
}

/**
 * Asserts a single event of `type` for `recordId` carrying the record under
 * `payloadKey`. `expectPlaintext` pins invariant 2 (decrypted payload) for the
 * verbs that decrypt before emitting; it is relaxed only for the single-delete
 * CONTROL, whose `previousData` is the raw pre-delete snapshot (ciphertext at
 * rest on the enc model — delete.ts never decrypts it, exactly as single
 * delete's own audit stores it; batch-delete DOES decrypt, so `batch_deleted`
 * keeps the plaintext assertion).
 */
function expectRecordEvent(
  events: CrudEventPayload[],
  type: string,
  recordId: string,
  payloadKey: 'data' | 'previousData' = 'data',
  expectPlaintext = true,
): CrudEventPayload {
  const matches = ofType(events, type).filter((event) => String(event.recordId) === recordId);
  expect(matches, `expected exactly one '${type}' event for ${recordId}`).toHaveLength(1);
  const event = matches[0]!;
  expect(typeof event.table).toBe('string');
  expect(event.table.length).toBeGreaterThan(0);
  expect(typeof event.timestamp).toBe('string');
  const record = event[payloadKey] as ConformanceRecord | null;
  expect(record, `'${type}' event must carry the record under ${payloadKey}`).toBeTruthy();
  if (expectPlaintext) {
    expect(record?.secret).toBe(PLAINTEXT);
  }
  return event;
}

async function seed(
  ctx: CtxGetter,
  overrides: Record<string, unknown> = {},
): Promise<ConformanceRecord> {
  const { app } = ctx();
  const email = (overrides.email as string) ?? `evt-${crypto.randomUUID()}@conformance.test`;
  return createRecord(app, BASE, {
    name: 'Event Person',
    role: 'user',
    age: 30,
    secret: PLAINTEXT,
    ...overrides,
    email,
  });
}

export function registerEventCells(descriptor: AdapterDescriptor, ctx: CtxGetter): void {
  if (!descriptor.capabilities.fieldEncryption) {
    test.skip(`event emission across mutation verbs [skipped: ${descriptor.name} mounts no complete mutation-verb route family]`, () => {});
    return;
  }

  // --------------------------------------------------------------------------
  // Controls: the four verbs that already emitted — the mirror the rest join.
  // --------------------------------------------------------------------------
  test('create emits `created` with the decrypted record (baseline mirror)', async () => {
    let created: ConformanceRecord | undefined;
    const events = await captureEvents(async () => {
      created = await seed(ctx);
    });
    expectRecordEvent(events, 'created', created!.id);
  });

  test('update emits `updated` with data + previousData', async () => {
    const record = await seed(ctx);
    const { app } = ctx();
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/${record.id}`,
        jsonInit('PATCH', { name: 'Renamed', secret: PLAINTEXT }),
      );
      expect(res.status).toBe(200);
    });
    const event = expectRecordEvent(events, 'updated', record.id);
    expect(event.previousData).toBeTruthy();
  });

  test('delete emits `deleted` with the pre-delete record under previousData', async () => {
    const record = await seed(ctx);
    const { app } = ctx();
    const events = await captureEvents(async () => {
      const res = await app.request(`${BASE}/${record.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
    });
    // Single delete emits the raw pre-delete snapshot (ciphertext at rest on the
    // enc model) — not decrypted, mirroring single delete's own audit entry.
    expectRecordEvent(events, 'deleted', record.id, 'previousData', false);
  });

  test('restore emits `restored` with the decrypted record', async () => {
    const record = await seed(ctx);
    const { app } = ctx();
    await app.request(`${BASE}/${record.id}`, { method: 'DELETE' });
    const events = await captureEvents(async () => {
      const res = await app.request(`${BASE}/${record.id}/restore`, { method: 'POST' });
      expect(res.status).toBe(200);
    });
    expectRecordEvent(events, 'restored', record.id);
  });

  // --------------------------------------------------------------------------
  // Single-record verbs added by this PR.
  // --------------------------------------------------------------------------
  test('upsert (create branch) emits `upserted` with metadata.created = true', async () => {
    const { app } = ctx();
    const email = `evt-upsert-new-${crypto.randomUUID()}@x.test`;
    let id = '';
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/upsert`,
        jsonInit('POST', { name: 'Upsert New', email, role: 'user', age: 31, secret: PLAINTEXT }),
      );
      expect(res.status).toBe(201);
      id = ((await res.json()) as { result: ConformanceRecord }).result.id;
    });
    const event = expectRecordEvent(events, 'upserted', id);
    expect(event.metadata?.created).toBe(true);
  });

  test('upsert (update branch) emits `upserted` with metadata.created = false + previousData', async () => {
    const seeded = await seed(ctx, { email: `evt-upsert-upd-${crypto.randomUUID()}@x.test` });
    const { app } = ctx();
    const events = await captureEvents(async () => {
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
    });
    const event = expectRecordEvent(events, 'upserted', seeded.id);
    expect(event.metadata?.created).toBe(false);
    expect(event.previousData).toBeTruthy();
  });

  test('clone emits `cloned` with the new record', async () => {
    const source = await seed(ctx);
    const { app } = ctx();
    const cloneEmail = `evt-clone-${crypto.randomUUID()}@x.test`;
    let cloneId = '';
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/${source.id}/clone`,
        jsonInit('POST', { email: cloneEmail, secret: PLAINTEXT }),
      );
      expect(res.status).toBe(201);
      cloneId = ((await res.json()) as { result: ConformanceRecord }).result.id;
    });
    expect(cloneId).not.toBe(source.id);
    expectRecordEvent(events, 'cloned', cloneId);
  });

  test('import (create mode) emits `imported` per row with metadata.status', async () => {
    const { app } = ctx();
    const email = `evt-import-${crypto.randomUUID()}@x.test`;
    let id = '';
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/import`,
        jsonInit('POST', {
          items: [{ name: 'Imported', email, role: 'user', age: 34, secret: PLAINTEXT }],
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { results: Array<{ data?: ConformanceRecord }> };
      };
      id = body.result.results[0]!.data!.id;
    });
    const event = expectRecordEvent(events, 'imported', id);
    expect(event.metadata?.status).toBe('created');
  });

  // bulkPatch event emission diverges by adapter. Core emits `bulk_patched` PER
  // affected record, and can only do so when the adapter surfaces the patched
  // rows (see core/src/endpoints/bulk-patch.ts — events fire off the returned
  // `decryptedRecords`). Memory/drizzle re-read and return the rows, so the
  // event fires. Prisma's bulk-patch is a single count-only `updateMany` that
  // returns ONLY a count and never the rows — the singular per-record event
  // payload (`recordId`/`data`) literally cannot be built from a count — so
  // prisma emits NOTHING. That is a confirmed, documented divergence, PINNED
  // here (never fixed) via the `bulkPatchReturnsRecords` capability.
  if (descriptor.capabilities.bulkPatchReturnsRecords) {
    test('bulkPatch emits `bulk_patched` per affected record', async () => {
      const seeded = await seed(ctx, { role: 'guest', secret: PLAINTEXT });
      const { app } = ctx();
      const events = await captureEvents(async () => {
        const res = await app.request(
          `${BASE}/bulk?role=guest`,
          jsonInit('PATCH', { secret: PLAINTEXT }),
        );
        expect(res.status).toBe(200);
      });
      expectRecordEvent(events, 'bulk_patched', seeded.id);
    });
  } else {
    test(`bulkPatch emits NO event on ${descriptor.name} [PINNED divergence: count-only updateMany surfaces no per-record ids]`, async () => {
      const seeded = await seed(ctx, { role: 'guest', secret: PLAINTEXT });
      const { app } = ctx();
      const events = await captureEvents(async () => {
        const res = await app.request(
          `${BASE}/bulk?role=guest`,
          jsonInit('PATCH', { secret: PLAINTEXT }),
        );
        expect(res.status).toBe(200);
        // A row genuinely WAS patched — so this pins "patched but no event",
        // not the trivially-empty "nothing matched" case.
        const body = (await res.json()) as { updated: number };
        expect(body.updated).toBe(1);
      });
      // Zero `bulk_patched` events: the count-only updateMany cannot fan out one
      // event per record because it never returns the records. Do NOT "fix" this
      // by re-reading rows in the adapter — the divergence is intentional.
      expect(ofType(events, 'bulk_patched')).toHaveLength(0);
      // The row referenced by `seeded` still exists (sanity: the patch targeted it).
      expect(seeded.id).toBeTruthy();
    });
  }

  // --------------------------------------------------------------------------
  // Batch verbs added by this PR — one event PER record.
  // --------------------------------------------------------------------------
  test('batchCreate emits `batch_created` per record', async () => {
    const { app } = ctx();
    const ids: string[] = [];
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/batch`,
        jsonInit('POST', {
          items: [
            { name: 'BC One', email: `evt-bc1-${crypto.randomUUID()}@x.test`, secret: PLAINTEXT },
            { name: 'BC Two', email: `evt-bc2-${crypto.randomUUID()}@x.test`, secret: PLAINTEXT },
          ],
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { result: { created: ConformanceRecord[] } };
      ids.push(...body.result.created.map((r) => r.id));
    });
    expect(ofType(events, 'batch_created')).toHaveLength(2);
    for (const id of ids) expectRecordEvent(events, 'batch_created', id);
  });

  test('batchUpdate emits `batch_updated` per record', async () => {
    const seeded = await seed(ctx, { secret: 'old-secret' });
    const { app } = ctx();
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/batch`,
        jsonInit('PATCH', { items: [{ id: seeded.id, data: { secret: PLAINTEXT } }] }),
      );
      expect(res.status).toBe(200);
    });
    expect(ofType(events, 'batch_updated')).toHaveLength(1);
    expectRecordEvent(events, 'batch_updated', seeded.id);
  });

  test('batchDelete emits `batch_deleted` per record under previousData', async () => {
    const seeded = await seed(ctx);
    const { app } = ctx();
    const events = await captureEvents(async () => {
      const res = await app.request(`${BASE}/batch`, jsonInit('DELETE', { ids: [seeded.id] }));
      expect(res.status).toBe(200);
    });
    expect(ofType(events, 'batch_deleted')).toHaveLength(1);
    expectRecordEvent(events, 'batch_deleted', seeded.id, 'previousData');
  });

  test('batchRestore emits `batch_restored` per record', async () => {
    const seeded = await seed(ctx);
    const { app } = ctx();
    await app.request(`${BASE}/${seeded.id}`, { method: 'DELETE' });
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/batch/restore`,
        jsonInit('POST', { ids: [seeded.id] }),
      );
      expect(res.status).toBe(200);
    });
    expect(ofType(events, 'batch_restored')).toHaveLength(1);
    expectRecordEvent(events, 'batch_restored', seeded.id);
  });

  test('batchUpsert emits `batch_upserted` per record with metadata.created', async () => {
    const { app } = ctx();
    const email = `evt-bu-${crypto.randomUUID()}@x.test`;
    let id = '';
    const events = await captureEvents(async () => {
      const res = await app.request(
        `${BASE}/batch/upsert`,
        jsonInit('POST', [{ name: 'BU One', email, role: 'user', age: 33, secret: PLAINTEXT }]),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { items: Array<{ data: ConformanceRecord }> };
      };
      id = body.result.items[0]!.data.id;
    });
    const event = expectRecordEvent(events, 'batch_upserted', id);
    expect(event.metadata?.created).toBe(true);
  });
}
