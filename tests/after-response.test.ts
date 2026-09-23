import { Hono } from 'hono';
import { createAfterResponse, runAfterResponse } from 'hono-crud/cloudflare';
import { describe, expect, it } from 'vitest';

describe('runAfterResponse / createAfterResponse', () => {
  it('hands the promise to executionCtx.waitUntil when one exists', async () => {
    const app = new Hono();
    const captured: Promise<unknown>[] = [];
    let settled = false;

    app.get('/', (c) => {
      const afterResponse = createAfterResponse(c);
      afterResponse(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 5),
        ),
      );
      return c.text('ok');
    });

    const executionCtx = {
      waitUntil: (promise: Promise<unknown>) => {
        captured.push(promise);
      },
      passThroughOnException: () => {},
    };
    const res = await app.request('/', undefined, undefined, executionCtx as never);
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    await captured[0];
    expect(settled).toBe(true);
  });

  it('runs in-band and routes a rejection to onError when there is no execution context', async () => {
    const app = new Hono();
    const errors: unknown[] = [];

    app.get('/', (c) => {
      runAfterResponse(c, Promise.reject(new Error('boom')), (err) => {
        errors.push(err);
      });
      return c.text('ok');
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    // Let the rejection propagate through the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });
});
