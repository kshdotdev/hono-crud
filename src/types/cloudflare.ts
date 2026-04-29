/**
 * Cloudflare Workers bindings helper types.
 *
 * Provides minimal type helpers for using hono-crud with Cloudflare Workers
 * without requiring `@cloudflare/workers-types` as a dependency.
 *
 * @example
 * ```ts
 * import type { CloudflareEnv, WaitUntilFn } from 'hono-crud/cloudflare';
 * import { getWaitUntil } from 'hono-crud/cloudflare';
 * import { registerWebhooks } from 'hono-crud';
 *
 * type Env = CloudflareEnv<{
 *   DB: D1Database;
 *   CACHE_KV: KVNamespace;
 * }>;
 *
 * app.use('*', async (c, next) => {
 *   registerWebhooks({
 *     endpoints: [...],
 *     waitUntil: getWaitUntil(c),
 *   });
 *   await next();
 * });
 * ```
 */

import type { KVNamespace } from '../shared/kv-types';

// Re-export KVNamespace for convenience
export type { KVNamespace };

/**
 * Type for the `waitUntil` function available on Workers execution context.
 * Extends the lifetime of the event past the response.
 */
export type WaitUntilFn = (promise: Promise<unknown>) => void;

/**
 * Hono environment type for Cloudflare Workers.
 * Wraps your bindings in the `Bindings` key as Hono expects.
 *
 * @example
 * ```ts
 * type Env = CloudflareEnv<{
 *   DB: D1Database;
 *   CACHE_KV: KVNamespace;
 *   RATE_LIMIT_KV: KVNamespace;
 * }>;
 *
 * const app = new Hono<Env>();
 * ```
 */
export type CloudflareEnv<
  B extends Record<string, unknown> = Record<string, unknown>,
> = {
  Bindings: B;
};

/**
 * Extracts the `waitUntil` function from a Hono context's execution context.
 * Bind it to `executionCtx` so it can be passed as a standalone function.
 *
 * @param ctx - The Hono context (must have `executionCtx.waitUntil`)
 * @returns Bound `waitUntil` function
 *
 * @example
 * ```ts
 * import { getWaitUntil } from 'hono-crud/cloudflare';
 * import { registerWebhooks } from 'hono-crud';
 *
 * app.use('*', async (c, next) => {
 *   registerWebhooks({
 *     endpoints: [{ url: 'https://hooks.example.com', events: ['create'] }],
 *     waitUntil: getWaitUntil(c),
 *   });
 *   await next();
 * });
 * ```
 */
export function getWaitUntil(ctx: {
  executionCtx: { waitUntil: WaitUntilFn };
}): WaitUntilFn {
  return ctx.executionCtx.waitUntil.bind(ctx.executionCtx);
}

/**
 * Safely extract the connecting IP from a Cloudflare Workers `Request`.
 *
 * Workers attach a non-standard `cf` property whose `ip` field holds the
 * client IP. This helper narrows from `unknown` with runtime checks instead
 * of casting blindly, and returns `undefined` outside Workers or when the
 * shape doesn't match.
 */
export function extractCloudflareIp(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object' || !('cf' in raw)) {
    return undefined;
  }
  const cf = (raw as { cf?: unknown }).cf;
  if (cf === null || typeof cf !== 'object' || !('ip' in cf)) {
    return undefined;
  }
  const ip = (cf as { ip?: unknown }).ip;
  return typeof ip === 'string' ? ip : undefined;
}
