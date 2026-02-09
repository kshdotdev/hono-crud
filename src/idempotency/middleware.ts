import type { MiddlewareHandler } from 'hono';
import type { IdempotencyConfig, IdempotencyEntry, IdempotencyStorage } from './types';
import { MemoryIdempotencyStorage } from './storage/memory';
import { createRegistryWithDefault } from '../storage/registry';

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Global idempotency storage registry.
 * Uses lazy initialization with MemoryIdempotencyStorage as default.
 */
export const idempotencyStorageRegistry = createRegistryWithDefault<IdempotencyStorage>(
  'idempotencyStorage',
  () => new MemoryIdempotencyStorage()
);

/**
 * Set the global idempotency storage.
 *
 * @example
 * ```ts
 * import { setIdempotencyStorage, MemoryIdempotencyStorage } from 'hono-crud';
 *
 * setIdempotencyStorage(new MemoryIdempotencyStorage());
 * ```
 */
export function setIdempotencyStorage(storage: IdempotencyStorage): void {
  idempotencyStorageRegistry.set(storage);
}

/**
 * Get the global idempotency storage.
 */
export function getIdempotencyStorage(): IdempotencyStorage {
  return idempotencyStorageRegistry.getRequired();
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Idempotency middleware for safe request retries.
 *
 * When a client sends an `Idempotency-Key` header on a mutating request,
 * the server stores the response and replays it for duplicate keys.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { idempotency } from 'hono-crud';
 *
 * const app = new Hono();
 * app.use('/api/*', idempotency());
 *
 * // Or with configuration:
 * app.use('/api/*', idempotency({
 *   ttl: 3600,              // 1 hour
 *   enforcedMethods: ['POST', 'PUT'],
 *   required: true,         // Require the header
 * }));
 * ```
 */
export function idempotency(config?: IdempotencyConfig): MiddlewareHandler {
  const headerName = config?.headerName ?? 'Idempotency-Key';
  const ttlSeconds = config?.ttl ?? 86400;
  const ttlMs = ttlSeconds * 1000;
  const enforcedMethods = (config?.enforcedMethods ?? ['POST']).map((m) => m.toUpperCase());
  const required = config?.required ?? false;
  const lockTimeoutMs = (config?.lockTimeout ?? 60) * 1000;

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
          {
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REQUIRED',
              message: `${headerName} header is required for ${method} requests`,
            },
          },
          400
        );
      }
      return next();
    }

    // Resolve storage
    const storage = config?.storage ?? idempotencyStorageRegistry.resolve(ctx);
    if (!storage) {
      // No storage configured, pass through
      return next();
    }

    // Check for existing response
    const existing = await storage.get(idempotencyKey);
    if (existing) {
      // Replay the cached response
      return new Response(existing.body, {
        status: existing.statusCode,
        headers: {
          ...existing.headers,
          'Content-Type': 'application/json',
          'Idempotency-Replayed': 'true',
        },
      });
    }

    // Check for in-flight request with same key
    const locked = await storage.isLocked(idempotencyKey);
    if (locked) {
      return ctx.json(
        {
          success: false,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'A request with this idempotency key is already being processed',
          },
        },
        409
      );
    }

    // Acquire lock
    const acquired = await storage.lock(idempotencyKey, lockTimeoutMs);
    if (!acquired) {
      return ctx.json(
        {
          success: false,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'A request with this idempotency key is already being processed',
          },
        },
        409
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
        key: idempotencyKey,
        statusCode: response.status,
        body,
        headers,
        createdAt: Date.now(),
      };

      await storage.set(idempotencyKey, entry, ttlMs);
    } finally {
      // Release lock
      await storage.unlock(idempotencyKey);
    }
  };
}
