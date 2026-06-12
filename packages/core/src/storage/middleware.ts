import type { Env, MiddlewareHandler } from 'hono';
import { CONTEXT_KEYS, type ContextKey } from '../core/context-keys';
import type { StorageEnv, StorageMiddlewareConfig } from './types';

/**
 * Maps each StorageMiddlewareConfig field to the CONTEXT_KEYS slot it writes.
 * One entry per first-class storage; iteration replaces the per-field if-ladder.
 */
const STORAGE_SLOTS: Record<keyof StorageMiddlewareConfig, ContextKey> = {
  loggingStorage: CONTEXT_KEYS.loggingStorage,
  auditStorage: CONTEXT_KEYS.auditStorage,
  versioningStorage: CONTEXT_KEYS.versioningStorage,
  apiKeyStorage: CONTEXT_KEYS.apiKeyStorage,
  approvalStorage: CONTEXT_KEYS.approvalStorage,
  cacheStorage: CONTEXT_KEYS.cacheStorage,
  rateLimitStorage: CONTEXT_KEYS.rateLimitStorage,
  idempotencyStorage: CONTEXT_KEYS.idempotencyStorage,
  eventEmitter: CONTEXT_KEYS.eventEmitter,
};

/**
 * Creates middleware that injects storage instances into Hono context.
 * This is the recommended approach for serverless environments where
 * global storage can cause issues with cold starts and state persistence.
 *
 * @param config - Storage instances to inject
 * @returns Middleware handler
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { MemoryCacheStorage } from '@hono-crud/cache';
 * import { createStorageMiddleware } from 'hono-crud/storage';
 * import { MemoryRateLimitStorage } from '@hono-crud/rate-limit';
 *
 * const app = new Hono();
 *
 * // Inject storage instances into context
 * app.use('/*', createStorageMiddleware({
 *   rateLimitStorage: new MemoryRateLimitStorage(),
 *   cacheStorage: new MemoryCacheStorage(),
 * }));
 *
 * // Storage is now available to all downstream middleware and routes
 * ```
 *
 * @example
 * ```ts
 * // Multi-tenant setup with per-tenant storage
 * app.use('/:tenantId/*', async (ctx, next) => {
 *   const tenantId = ctx.req.param('tenantId');
 *
 *   // Get or create tenant-specific storage
 *   const storage = getTenantStorage(tenantId);
 *
 *   // Create middleware dynamically
 *   const middleware = createStorageMiddleware({
 *     rateLimitStorage: storage.rateLimit,
 *     cacheStorage: storage.cache,
 *   });
 *
 *   return middleware(ctx, next);
 * });
 * ```
 */
export function createStorageMiddleware<E extends Env = Env>(
  config: StorageMiddlewareConfig,
): MiddlewareHandler<E & StorageEnv> {
  return async (ctx, next) => {
    for (const [field, key] of Object.entries(STORAGE_SLOTS) as [
      keyof StorageMiddlewareConfig,
      ContextKey,
    ][]) {
      const value = config[field];
      if (value) {
        // ctx.set is typed against StorageEnv['Variables']; key strings align 1:1
        // with the CONTEXT_KEYS slots, so the boundary cast is sound.
        ctx.set(key as never, value as never);
      }
    }
    await next();
  };
}

/**
 * Creates middleware that injects only logging storage.
 *
 * @param storage - Logging storage instance
 * @returns Middleware handler
 */
export function createLoggingStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['loggingStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ loggingStorage: storage });
}

/**
 * Creates middleware that injects only audit storage.
 *
 * @param storage - Audit storage instance
 * @returns Middleware handler
 */
export function createAuditStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['auditStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ auditStorage: storage });
}

/**
 * Creates middleware that injects only versioning storage.
 *
 * @param storage - Versioning storage instance
 * @returns Middleware handler
 */
export function createVersioningStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['versioningStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ versioningStorage: storage });
}

/**
 * Creates middleware that injects only API key storage.
 *
 * @param storage - API key storage instance
 * @returns Middleware handler
 */
export function createAPIKeyStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['apiKeyStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ apiKeyStorage: storage });
}

/**
 * Creates middleware that injects only approval storage.
 *
 * @param storage - Approval storage instance
 * @returns Middleware handler
 */
export function createApprovalStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['approvalStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ approvalStorage: storage });
}

/**
 * Creates middleware that injects only cache storage.
 *
 * @param storage - Cache storage instance
 * @returns Middleware handler
 */
export function createCacheStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['cacheStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ cacheStorage: storage });
}

/**
 * Creates middleware that injects only rate limit storage.
 *
 * @param storage - Rate limit storage instance
 * @returns Middleware handler
 */
export function createRateLimitStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['rateLimitStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ rateLimitStorage: storage });
}

/**
 * Creates middleware that injects only idempotency storage.
 *
 * @param storage - Idempotency storage instance
 * @returns Middleware handler
 */
export function createIdempotencyStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['idempotencyStorage']>,
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ idempotencyStorage: storage });
}
