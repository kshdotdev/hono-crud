import type { Context, Env, MiddlewareHandler } from 'hono';
import { CONTEXT_KEYS, createStorageFeature, getContextVar } from 'hono-crud/internal';
import type { ErrorResponse } from 'hono-crud/internal';
import type { IdempotencyConfig, IdempotencyEntry, IdempotencyStorage } from './types';

/**
 * Build a standard error envelope. Typed as the shared {@link ErrorResponse} so
 * these bodies stay in lockstep with the framework's canonical error contract
 * (`{ success: false, error: { code, message } }`) instead of being re-declared
 * inline at each return site.
 */
function idempotencyError(code: string, message: string): ErrorResponse {
  return { success: false, error: { code, message } };
}

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Idempotency storage feature.
 * Shared registry + getter/resolver quartet. Prefer passing storage explicitly
 * or injecting it with createStorageMiddleware() in edge runtimes.
 */
const idempotencyStorageFeature = createStorageFeature<IdempotencyStorage>({
  contextKey: CONTEXT_KEYS.idempotencyStorage,
});

/** The backing registry (exported for advanced use / tests). */
export const idempotencyStorageRegistry = idempotencyStorageFeature.registry;

/**
 * Set the global idempotency storage.
 *
 * @example
 * ```ts
 * import { setIdempotencyStorage, MemoryIdempotencyStorage } from '@hono-crud/idempotency';
 *
 * setIdempotencyStorage(new MemoryIdempotencyStorage());
 * ```
 */
export const setIdempotencyStorage = idempotencyStorageFeature.set;

/**
 * Get the explicitly-configured global idempotency storage, or null.
 * Never throws. Use {@link getIdempotencyStorageRequired} when a non-null
 * storage is required.
 */
export const getIdempotencyStorage = idempotencyStorageFeature.get;

/**
 * Get the global idempotency storage, throwing if none was configured.
 */
export const getIdempotencyStorageRequired = idempotencyStorageFeature.getRequired;

/**
 * Resolves idempotency storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export function resolveIdempotencyStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: IdempotencyStorage,
): IdempotencyStorage | null {
  return idempotencyStorageFeature.resolve(ctx, explicitStorage);
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Creates idempotency middleware for safe request retries.
 *
 * When a client sends an `Idempotency-Key` header on a mutating request,
 * the server stores the response and replays it for duplicate keys.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import {
 *   createIdempotencyMiddleware,
 *   MemoryIdempotencyStorage,
 * } from '@hono-crud/idempotency';
 *
 * const app = new Hono();
 * app.use('/api/*', createIdempotencyMiddleware({
 *   storage: new MemoryIdempotencyStorage(),
 * }));
 *
 * // Or with configuration:
 * app.use('/api/*', createIdempotencyMiddleware({
 *   ttl: 3600,              // 1 hour
 *   enforcedMethods: ['POST', 'PUT'],
 *   required: true,         // Require the header
 * }));
 * ```
 */
export function createIdempotencyMiddleware<E extends Env = Env>(
  config: IdempotencyConfig = {},
): MiddlewareHandler<E> {
  const headerName = config.headerName ?? 'Idempotency-Key';
  const ttlSeconds = config.ttl ?? 86400;
  const ttlMs = ttlSeconds * 1000;
  const enforcedMethods = (config.enforcedMethods ?? ['POST']).map((m) => m.toUpperCase());
  const required = config.required ?? false;
  const lockTimeoutMs = (config.lockTimeout ?? 60) * 1000;

  return async (ctx, next) => {
    const method = ctx.req.method.toUpperCase();

    // Only apply to enforced methods
    if (!enforcedMethods.includes(method)) {
      return next();
    }

    const idempotencyKey = ctx.req.header(headerName);

    // If no key provided
    if (!idempotencyKey) {
      if (required) {
        return ctx.json(
          idempotencyError(
            'IDEMPOTENCY_KEY_REQUIRED',
            `${headerName} header is required for ${method} requests`,
          ),
          400,
        );
      }
      return next();
    }

    // Resolve storage (explicit config.storage > context > global, single tier)
    const storage = resolveIdempotencyStorage(ctx, config.storage);
    if (!storage) {
      // No storage configured, pass through
      return next();
    }

    // Scope the key to the authenticated user to prevent cross-user replay
    const userId = getContextVar<string>(ctx, 'userId') || 'anonymous';
    const scopedKey = `${userId}:${idempotencyKey}`;

    // Check for existing response
    const existing = await storage.get(scopedKey);
    if (existing) {
      // Replay the cached response. Preserve the original Content-Type
      // (do not hard-code application/json — the original handler may have
      // returned XML, plain text, binary, etc.).
      return new Response(existing.body, {
        status: existing.statusCode,
        headers: {
          ...existing.headers,
          'Idempotency-Replayed': 'true',
        },
      });
    }

    // Check for in-flight request with same key
    const locked = await storage.isLocked(scopedKey);
    if (locked) {
      return ctx.json(
        idempotencyError(
          'IDEMPOTENCY_CONFLICT',
          'A request with this idempotency key is already being processed',
        ),
        409,
      );
    }

    // Acquire lock
    const acquired = await storage.lock(scopedKey, lockTimeoutMs);
    if (!acquired) {
      return ctx.json(
        idempotencyError(
          'IDEMPOTENCY_CONFLICT',
          'A request with this idempotency key is already being processed',
        ),
        409,
      );
    }

    try {
      // Process the request
      await next();

      // Store the response for replay
      const response = ctx.res;
      const body = await response.clone().text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const entry: IdempotencyEntry = {
        key: scopedKey,
        statusCode: response.status,
        body,
        headers,
        createdAt: Date.now(),
      };

      await storage.set(scopedKey, entry, ttlMs);
    } finally {
      // Release lock
      await storage.unlock(scopedKey);
    }
  };
}
