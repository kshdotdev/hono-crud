/**
 * `waitUntil` helper for fire-and-forget work.
 * Uses the Cloudflare/Vercel `executionCtx.waitUntil` if available;
 * otherwise the work runs synchronously in-band.
 */

import type { Context, Env } from 'hono';

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
