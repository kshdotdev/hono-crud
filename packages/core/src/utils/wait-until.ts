/**
 * `waitUntil` helper for fire-and-forget work.
 * Uses the Cloudflare/Vercel `executionCtx.waitUntil` if available;
 * otherwise the work runs synchronously in-band.
 */

import type { Context, Env } from 'hono';
import { getLogger } from '../core/logger';

export type WaitUntil = (promise: Promise<unknown>) => void;

interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function getWaitUntil<E extends Env>(ctx: Context<E>): WaitUntil | undefined {
  let execCtx: ExecutionContextLike | undefined;
  try {
    execCtx = ctx.executionCtx as ExecutionContextLike | undefined;
  } catch {
    execCtx = undefined;
  }
  if (execCtx && typeof execCtx.waitUntil === 'function') {
    return execCtx.waitUntil.bind(execCtx);
  }
  return undefined;
}

/**
 * Run a promise as background work that outlives the response.
 *
 * On runtimes with an execution context (Cloudflare Workers, Vercel Edge,
 * Deno Deploy) the promise is handed to `executionCtx.waitUntil`, which is
 * the ONLY way pending work survives the response — a bare `.then()` chain
 * is cancelled when the response returns. Elsewhere the promise runs
 * in-band with its rejection logged, never unhandled.
 *
 * `onError` replaces the default log line (e.g. to report to an error
 * tracker); on Workers the platform surfaces rejections itself.
 */
export function runAfterResponse<E extends Env>(
  ctx: Context<E>,
  promise: Promise<unknown>,
  onError?: (error: unknown) => void,
): void {
  const waitUntil = getWaitUntil(ctx);
  if (waitUntil) {
    waitUntil(promise);
    return;
  }
  promise.catch((err) => {
    if (onError) {
      onError(err);
      return;
    }
    getLogger().error('Background task failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Bind {@link runAfterResponse} to a request context, producing a
 * `waitUntil`-shaped function that works on every runtime. Handy for
 * middleware that fires webhooks, cache invalidation or audit writes after
 * the response.
 *
 * @example
 * ```ts
 * app.use('*', async (c, next) => {
 *   const afterResponse = createAfterResponse(c);
 *   await next();
 *   afterResponse(notifyAnalytics(c.req.path));
 * });
 * ```
 */
export function createAfterResponse<E extends Env>(
  ctx: Context<E>,
  onError?: (error: unknown) => void,
): WaitUntil {
  return (promise) => runAfterResponse(ctx, promise, onError);
}
