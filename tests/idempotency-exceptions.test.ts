/**
 * Idempotency error-path tests (batch B5):
 *
 * 1. The middleware THROWS ApiExceptions (IdempotencyKeyRequiredException 400 /
 *    IdempotencyConflictException 409) instead of hand-returning ctx.json
 *    envelopes — so the errors flow through createErrorHandler (ErrorMappers /
 *    ErrorHooks / responseEnvelope) like every sibling middleware.
 * 2. A custom responseEnvelope shapes idempotency errors.
 * 3. Missing-storage posture: `required: true` + null storage throws
 *    ConfigurationException; default config warns once per isolate and passes
 *    through.
 */

import {
  IdempotencyConflictException,
  IdempotencyKeyRequiredException,
  MemoryIdempotencyStorage,
  createIdempotencyMiddleware,
} from '@hono-crud/idempotency';
import { idempotencyStorageRegistry } from '@hono-crud/idempotency';
import { Hono } from 'hono';
import { ConfigurationException, createErrorHandler } from 'hono-crud';
import type { ResponseEnvelope } from 'hono-crud';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  idempotencyStorageRegistry.reset();
});
afterEach(() => {
  idempotencyStorageRegistry.reset();
});

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('idempotency exceptions flow through createErrorHandler', () => {
  function buildApp(required: boolean) {
    const app = new Hono();
    app.onError(createErrorHandler());
    app.use(
      '/*',
      createIdempotencyMiddleware({
        storage: new MemoryIdempotencyStorage(),
        required,
        lockTimeoutSeconds: 60,
      }),
    );
    app.post('/op', (c) => c.json({ ok: true }));
    return app;
  }

  it('missing header with required:true → 400 IDEMPOTENCY_KEY_REQUIRED with details', async () => {
    const app = buildApp(true);
    const res = await app.request('/op', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(body.error.message).toContain('Idempotency-Key');
    expect(body.error.details).toEqual({ headerName: 'Idempotency-Key', method: 'POST' });
  });

  it('in-flight key → 409 IDEMPOTENCY_CONFLICT with the client key in details', async () => {
    const storage = new MemoryIdempotencyStorage();
    const app = new Hono();
    app.onError(createErrorHandler());
    app.use('/*', createIdempotencyMiddleware({ storage }));
    app.post('/op', (c) => c.json({ ok: true }));

    // Simulate an in-flight request by holding the lock for the scoped key.
    await storage.lock('anonymous:dup-key', 60_000);

    const res = await app.request('/op', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'dup-key' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(body.error.details).toEqual({ idempotencyKey: 'dup-key' });
  });

  it('exceptions are instanceof targets for mappers/hooks', () => {
    const required = new IdempotencyKeyRequiredException('Idempotency-Key', 'POST');
    expect(required.status).toBe(400);
    expect(required.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const conflict = new IdempotencyConflictException('k');
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('a bare Hono app (no onError) still emits the canonical envelope via getResponse()', async () => {
    const app = new Hono();
    app.use(
      '/*',
      createIdempotencyMiddleware({ required: true, storage: new MemoryIdempotencyStorage() }),
    );
    app.post('/op', (c) => c.json({ ok: true }));
    const res = await app.request('/op', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('idempotency errors honor a custom responseEnvelope', () => {
  it('shapes 400/409 through the configured envelope (no legacy envelope leak)', async () => {
    const envelope: ResponseEnvelope = {
      success: (result) => ({ data: result }),
      error: (err) => ({ problems: [{ kind: err.code, detail: err.message }] }),
    };

    const storage = new MemoryIdempotencyStorage();
    await storage.lock('anonymous:held', 60_000);

    const app = new Hono();
    app.onError(createErrorHandler({ responseEnvelope: envelope }));
    app.use('/*', createIdempotencyMiddleware({ storage, required: true }));
    app.post('/op', (c) => c.json({ ok: true }));

    const missing = await app.request('/op', { method: 'POST' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      problems: [
        { kind: 'IDEMPOTENCY_KEY_REQUIRED', detail: expect.stringContaining('Idempotency-Key') },
      ],
    });

    const conflict = await app.request('/op', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'held' },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      problems: [{ kind: 'IDEMPOTENCY_CONFLICT', detail: expect.stringContaining('already') }],
    });
  });
});

describe('missing-storage posture', () => {
  it('required:true + no storage anywhere → ConfigurationException (500 CONFIGURATION_ERROR)', async () => {
    const app = new Hono();
    app.onError(createErrorHandler());
    app.use('/*', createIdempotencyMiddleware({ required: true }));
    app.post('/op', (c) => c.json({ ok: true }));

    const res = await app.request('/op', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('CONFIGURATION_ERROR');
    expect(body.error.message).toContain('Idempotency storage not configured');
  });

  it('ConfigurationException is the thrown type (unit)', () => {
    expect(new ConfigurationException('x').code).toBe('CONFIGURATION_ERROR');
  });

  it('default config + no storage → passes through (no replay protection)', async () => {
    let calls = 0;
    const app = new Hono();
    app.use('/*', createIdempotencyMiddleware());
    app.post('/op', (c) => {
      calls++;
      return c.json({ calls });
    });

    const headers = { 'Idempotency-Key': 'k2' };
    await app.request('/op', { method: 'POST', headers });
    const second = await app.request('/op', { method: 'POST', headers });
    // No storage → both requests hit the handler (documented degraded mode).
    expect(calls).toBe(2);
    expect(second.headers.get('Idempotency-Replayed')).toBeNull();
  });
});
