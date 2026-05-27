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
