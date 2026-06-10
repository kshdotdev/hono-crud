import type { Context } from 'hono';
import { OpenAPIRoute } from 'hono-crud';
// Published as the `hono-crud/cloudflare` subpath export
// (package.json maps it to dist/types/cloudflare).
import { getWaitUntil as getWaitUntilCloudflare } from 'hono-crud/types/cloudflare';
import { getWaitUntil } from 'hono-crud/utils/wait-until';
import { describe, expect, it, vi } from 'vitest';

/**
 * Builds a context-like object whose `executionCtx` getter throws, mirroring
 * Hono's real behaviour outside a Workers/edge runtime
 * (`This context has no ExecutionContext`).
 */
function ctxWithoutExecutionCtx(): Context {
  return {
    get executionCtx(): never {
      throw new Error('This context has no ExecutionContext');
    },
  } as unknown as Context;
}

function ctxWithExecutionCtx(waitUntil: (p: Promise<unknown>) => void): Context {
  return {
    executionCtx: { waitUntil },
  } as unknown as Context;
}

describe('getWaitUntil (utils/wait-until)', () => {
  it('returns undefined (no throw) when the context has no ExecutionContext', () => {
    const ctx = ctxWithoutExecutionCtx();
    expect(() => getWaitUntil(ctx)).not.toThrow();
    expect(getWaitUntil(ctx)).toBeUndefined();
  });

  it('returns a bound waitUntil function when executionCtx exists', () => {
    const spy = vi.fn();
    const ctx = ctxWithExecutionCtx(spy);
    const waitUntil = getWaitUntil(ctx);
    expect(typeof waitUntil).toBe('function');
    const promise = Promise.resolve();
    // biome-ignore lint/style/noNonNullAssertion: asserted to be a function above
    waitUntil!(promise);
    expect(spy).toHaveBeenCalledWith(promise);
  });
});

describe('getWaitUntil (hono-crud/cloudflare public export)', () => {
  it('does not throw when the context has no ExecutionContext', () => {
    const ctx = ctxWithoutExecutionCtx();
    expect(() => getWaitUntilCloudflare(ctx)).not.toThrow();
    expect(getWaitUntilCloudflare(ctx)).toBeUndefined();
  });

  it('returns a bound waitUntil function when executionCtx exists', () => {
    const spy = vi.fn();
    const ctx = ctxWithExecutionCtx(spy);
    const waitUntil = getWaitUntilCloudflare(ctx);
    expect(typeof waitUntil).toBe('function');
    const promise = Promise.resolve();
    // biome-ignore lint/style/noNonNullAssertion: asserted to be a function above
    waitUntil!(promise);
    expect(spy).toHaveBeenCalledWith(promise);
  });
});

/**
 * Minimal concrete route that exposes the protected `runAfterResponse`
 * so the inline-fallback behaviour can be exercised directly.
 */
class TestRoute extends OpenAPIRoute {
  handle(): Response {
    return new Response(null);
  }

  exec(promise: Promise<unknown>): void {
    this.runAfterResponse(promise);
  }
}

describe('OpenAPIRoute.runAfterResponse', () => {
  it('runs the promise inline when waitUntil is absent', async () => {
    const route = new TestRoute();
    route.setContext(ctxWithoutExecutionCtx());

    let ran = false;
    const promise = Promise.resolve().then(() => {
      ran = true;
    });
    route.exec(promise);
    await promise;
    expect(ran).toBe(true);
  });

  it('hands the promise to executionCtx.waitUntil when available', () => {
    const spy = vi.fn();
    const route = new TestRoute();
    route.setContext(ctxWithExecutionCtx(spy));

    const promise = Promise.resolve();
    route.exec(promise);
    expect(spy).toHaveBeenCalledWith(promise);
  });
});
