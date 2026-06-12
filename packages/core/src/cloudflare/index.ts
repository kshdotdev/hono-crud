/**
 * Cloudflare Workers bindings helper types.
 *
 * Provides minimal type helpers for using hono-crud with Cloudflare Workers
 * without requiring `@cloudflare/workers-types` as a dependency.
 *
 * @example
 * ```ts
 * import type { CloudflareEnv, WaitUntil } from 'hono-crud/cloudflare';
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

/**
 * Minimal Cloudflare KV Namespace interface.
 * Defined locally to avoid depending on @cloudflare/workers-types.
 */
export interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Extracts the bound `executionCtx.waitUntil` from a Hono context, returning
 * `undefined` (rather than throwing) when no execution context is available —
 * e.g. outside a Workers/edge runtime, where Hono's `executionCtx` getter
 * throws `This context has no ExecutionContext`.
 *
 * Re-exported from the shared `utils/wait-until` implementation, the single
 * source of truth for this behaviour.
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
export { getWaitUntil } from '../utils/wait-until';

/**
 * Type of the `waitUntil` function available on Workers execution context.
 * Extends the lifetime of the event past the response. Re-exported from
 * `utils/wait-until`, the single source of truth.
 */
export type { WaitUntil } from '../utils/wait-until';

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
export type CloudflareEnv<B extends Record<string, unknown> = Record<string, unknown>> = {
  Bindings: B;
};
