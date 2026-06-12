import type { Context, Env, MiddlewareHandler } from 'hono';
import {
  CONTEXT_KEYS,
  ConfigurationException,
  createStorageFeature,
  getContextVar,
  getLogger,
} from 'hono-crud/internal';
import { IdempotencyConflictException, IdempotencyKeyRequiredException } from './exceptions';
import type { IdempotencyConfig, IdempotencyEntry, IdempotencyStorage } from './types';

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

/** Once-per-isolate guard for the missing-storage warning (dedup, not request state). */
let warnedMissingIdempotencyStorage = false;

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
        throw new IdempotencyKeyRequiredException(headerName, method);
      }
      return next();
    }

    // Resolve storage (explicit config.storage > context > global, single tier)
    const storage = resolveIdempotencyStorage(ctx, config.storage);
    if (!storage) {
      if (required) {
        // The consumer declared the idempotency guarantee mandatory; a
        // mis-wired storage must fail loudly rather than silently void the
        // replay-protection guarantee (duplicate charges).
        throw new ConfigurationException(
          'Idempotency storage not configured but `required: true` was set. Inject ' +
            'idempotencyStorage with createStorageMiddleware() (recommended) or call ' +
            'setIdempotencyStorage().',
        );
      }
      if (!warnedMissingIdempotencyStorage) {
        warnedMissingIdempotencyStorage = true;
        getLogger().warn(
          'Idempotency storage not configured — requests pass through WITHOUT replay ' +
            'protection. Inject idempotencyStorage with createStorageMiddleware() ' +
            '(recommended) or call setIdempotencyStorage(). This warning is logged once per isolate.',
        );
      }
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

    // Check for in-flight request with same key.
    // Lock safety: both 409 throws below happen BEFORE this request holds the
    // lock (a failed `lock()` did not acquire it), so throwing here can never
    // leak a held lock — the try/finally that releases it starts only after a
    // successful acquire.
    const locked = await storage.isLocked(scopedKey);
    if (locked) {
      throw new IdempotencyConflictException(idempotencyKey);
    }

    // Acquire lock
    const acquired = await storage.lock(scopedKey, lockTimeoutMs);
    if (!acquired) {
      throw new IdempotencyConflictException(idempotencyKey);
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
