/**
 * Tests for the 0.10.0 `responseEnvelope` option on `RegisterCrudOptions`.
 *
 * The envelope is the **final formatting step** before the response body
 * is serialised. When omitted, behaviour is byte-identical to pre-0.10.0
 * (`{ success: true, result, result_info? }` and `{ success: false, error: { … } }`).
 * When provided, the two functions wrap success/error payloads to match
 * any house API standard — RFC 7807 Problem Details, JSON:API, or a
 * project's own envelope — without writing a response-rewriting middleware.
 *
 * Coverage:
 *   - Default envelope: success and error responses unchanged (regression
 *     guard for the byte-identical path).
 *   - Custom success envelope: list returns `{ data: [...] }`, single
 *     returns `{ data: <obj> }`.
 *   - Custom error envelope: 4xx error from inside the endpoint flows
 *     through the envelope's `error()` function.
 *   - Composition: `createErrorHandler({ mappers, responseEnvelope })`
 *     transforms the error first via the mapper, then wraps with the
 *     envelope.
 *   - Pagination: list endpoint passes `result_info` as the second arg
 *     to `envelope.success(result, info)`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  ConflictException,
  createErrorHandler,
  defineMeta,
  defineModel,
  fromHono,
  registerCrud,
  type ErrorMapper,
  type ResponseEnvelope,
} from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  clearStorage,
  getStorage,
} from '@hono-crud/memory';

// ============================================================================
// Fixture: a tiny Widget model + endpoints reused across cases
// ============================================================================

const Schema = z.object({
  id: z.string(),
  name: z.string(),
});
type Row = z.infer<typeof Schema>;

const Model = defineModel({
  tableName: 'widgets_env',
  schema: Schema,
  primaryKeys: ['id'],
});
const meta = defineMeta({ model: Model });

class Create extends MemoryCreateEndpoint {
  _meta = meta;
}
class List extends MemoryListEndpoint {
  _meta = meta;
}
class Read extends MemoryReadEndpoint {
  _meta = meta;
}
class Update extends MemoryUpdateEndpoint {
  _meta = meta;
}
class Del extends MemoryDeleteEndpoint {
  _meta = meta;
}

beforeEach(() => {
  clearStorage();
  getStorage<Row>('widgets_env').set('w1', { id: 'w1', name: 'one' });
  getStorage<Row>('widgets_env').set('w2', { id: 'w2', name: 'two' });
});

// ============================================================================
// Default envelope — regression guard
// ============================================================================

describe('responseEnvelope — default (no option)', () => {
  it('emits the historical { success, result } shape for single items', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', { read: Read });

    const res = await app.request('/widgets/w1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      result: { id: 'w1', name: 'one' },
    });
  });

  it('emits the historical { success, result, result_info } shape for lists', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', { list: List });

    const res = await app.request('/widgets');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result_info).toBeDefined();
    expect(body.result_info.page).toBe(1);
  });

  it('emits the historical { success: false, error } shape for errors', async () => {
    const app = fromHono(new Hono());
    app.onError(createErrorHandler({ logUnmappedErrors: false }));
    registerCrud(app, '/widgets', { read: Read });

    const res = await app.request('/widgets/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: "widgets_env with id 'missing' not found",
      },
    });
  });
});

// ============================================================================
// Custom success envelope
// ============================================================================

describe('responseEnvelope — custom success', () => {
  const dataEnvelope: ResponseEnvelope = {
    success: (result, info) =>
      info ? { data: result, meta: info } : { data: result },
    error: (err) => ({ error: err }),
  };

  it('wraps a single-item response in { data }', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', { read: Read }, { responseEnvelope: dataEnvelope });

    const res = await app.request('/widgets/w1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 'w1', name: 'one' } });
  });

  it('wraps a list response with { data, meta }', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', { list: List }, { responseEnvelope: dataEnvelope });

    const res = await app.request('/widgets');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // Pagination metadata is delivered as the `info` second arg, observable
    // via the envelope's `meta` slot.
    expect(body.meta).toBeDefined();
    expect(body.meta.page).toBe(1);
    // Default-shape leakage check — the envelope is fully replacing the
    // legacy `{ success, result, result_info }` keys.
    expect(body.success).toBeUndefined();
    expect(body.result).toBeUndefined();
    expect(body.result_info).toBeUndefined();
  });

  it('wraps a created response (201) in the envelope without losing the status code', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/widgets', { create: Create }, { responseEnvelope: dataEnvelope });

    const res = await app.request('/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'fresh' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('fresh');
    expect(typeof body.data.id).toBe('string'); // memory adapter generates uuid
    expect(body.success).toBeUndefined();
  });
});

// ============================================================================
// Custom error envelope (per-route via registerCrud)
// ============================================================================

describe('responseEnvelope — custom error', () => {
  const compactEnvelope: ResponseEnvelope = {
    success: (result) => ({ ok: true, value: result }),
    error: (err) => ({ ok: false, code: err.code, message: err.message }),
  };

  it('wraps a 404 from the endpoint through envelope.error()', async () => {
    const app = fromHono(new Hono());
    app.onError(createErrorHandler({ logUnmappedErrors: false }));
    registerCrud(app, '/widgets', { read: Read }, { responseEnvelope: compactEnvelope });

    const res = await app.request('/widgets/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: "widgets_env with id 'missing' not found",
    });
  });

  it('wraps a custom endpoint-side error() helper through envelope.error()', async () => {
    class FailingRead extends Read {
      override async handle(): Promise<Response> {
        return this.error('boom', 'INTERNAL', 500);
      }
    }
    const app = fromHono(new Hono());
    app.onError(createErrorHandler({ logUnmappedErrors: false }));
    registerCrud(
      app,
      '/widgets',
      { read: FailingRead },
      { responseEnvelope: compactEnvelope }
    );

    const res = await app.request('/widgets/w1');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: 'INTERNAL', message: 'boom' });
  });
});

// ============================================================================
// Composition: createErrorHandler mappers + responseEnvelope
// ============================================================================

describe('responseEnvelope — composes with createErrorHandler mappers', () => {
  it('mapper transforms the raw Error first; envelope wraps the structured output', async () => {
    // A custom DB error class our app throws.
    class DbConflict extends Error {
      constructor(public field: string) {
        super(`Duplicate ${field}`);
      }
    }

    // Mapper turns the raw error into a structured ConflictException.
    const dbMapper: ErrorMapper = (err) => {
      if (err instanceof DbConflict) {
        return new ConflictException(`already exists: ${err.field}`, {
          field: err.field,
        });
      }
      return undefined;
    };

    // Envelope is RFC-7807-ish — observably different from the legacy shape.
    const problemEnvelope: ResponseEnvelope = {
      success: (result) => ({ data: result }),
      error: (err) => ({
        type: `https://errors.example.com/${err.code}`,
        title: err.message,
        detail: err.details ?? null,
        status: 409,
      }),
    };

    const app = fromHono(new Hono());
    app.onError(
      createErrorHandler({
        mappers: [dbMapper],
        logUnmappedErrors: false,
      })
    );
    // Per-route envelope set via registerCrud — wins over the
    // handler-level default (which is `undefined` here anyway).
    registerCrud(
      app,
      '/widgets',
      { read: Read, create: Create },
      { responseEnvelope: problemEnvelope }
    );

    // Add a route that throws our custom DB error inside the registerCrud
    // path so the per-route envelope is in scope when the error handler
    // formats the body.
    app.post('/widgets/throw', () => {
      throw new DbConflict('email');
    });

    // Re-register the envelope for the throw route by attaching it to the
    // same prefix — easier: just hit a real CRUD route that triggers a
    // ConflictException-mappable error. We'll throw via a hook on Create.
    class ConflictingCreate extends Create {
      override async before(): Promise<Row> {
        throw new DbConflict('email');
      }
    }
    registerCrud(
      app,
      '/conflicting',
      { create: ConflictingCreate },
      { responseEnvelope: problemEnvelope }
    );

    const res = await app.request('/conflicting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', name: 'x' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    // Mapper output (`code: 'CONFLICT'`, `message: 'already exists: email'`,
    // `details: { field: 'email' }`) is fully observable inside the
    // envelope's wrapped shape — confirms the composition order.
    expect(body.type).toBe('https://errors.example.com/CONFLICT');
    expect(body.title).toBe('already exists: email');
    expect(body.detail).toEqual({ field: 'email' });
    expect(body.status).toBe(409);
  });

  it('handler-level default envelope wraps errors that propagate to app.onError', async () => {
    // This case exercises the OTHER error path: a raw Error (not an
    // ApiException) thrown from inside the endpoint, which propagates
    // out of the openapi.ts route wrapper and lands in `app.onError`.
    // The handler-level `responseEnvelope` then wraps the mapper output.
    const fallbackEnvelope: ResponseEnvelope = {
      success: (result) => ({ ok: true, result }),
      error: (err) => ({ ok: false, error: err.code }),
    };

    class ThrowingRead extends Read {
      override async handle(): Promise<Response> {
        throw new Error('plain-old-error');
      }
    }

    const app = fromHono(new Hono());
    app.onError(
      createErrorHandler({
        responseEnvelope: fallbackEnvelope,
        logUnmappedErrors: false,
      })
    );
    registerCrud(app, '/widgets', { read: ThrowingRead });

    const res = await app.request('/widgets/anything');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'INTERNAL_ERROR' });
  });

  it('per-route envelope wins over handler-level default', async () => {
    const handlerLevel: ResponseEnvelope = {
      success: (result) => ({ scope: 'handler', result }),
      error: (err) => ({ scope: 'handler', err }),
    };
    const routeLevel: ResponseEnvelope = {
      success: (result) => ({ scope: 'route', result }),
      error: (err) => ({ scope: 'route', err }),
    };

    const app = fromHono(new Hono());
    app.onError(
      createErrorHandler({
        responseEnvelope: handlerLevel,
        logUnmappedErrors: false,
      })
    );
    registerCrud(app, '/widgets', { read: Read }, { responseEnvelope: routeLevel });

    const res = await app.request('/widgets/missing');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.scope).toBe('route');
  });
});

// ============================================================================
// Delete: confirm the new prior-state delete still flows through envelope
// ============================================================================

describe('responseEnvelope — interacts cleanly with the 0.10.0 prior hook', () => {
  it('after-hook prior arg is unchanged when an envelope is in scope', async () => {
    let captured: Row | undefined;

    class PriorCapturingDelete extends Del {
      override async after(prior: Row): Promise<void> {
        captured = prior;
      }
    }

    const envelope: ResponseEnvelope = {
      success: (result) => ({ deleted: result }),
      error: (err) => ({ err }),
    };

    const app = fromHono(new Hono());
    registerCrud(
      app,
      '/widgets',
      { delete: PriorCapturingDelete },
      { responseEnvelope: envelope }
    );

    const res = await app.request('/widgets/w1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: { deleted: true } });
    expect(captured).toEqual({ id: 'w1', name: 'one' });
  });
});
