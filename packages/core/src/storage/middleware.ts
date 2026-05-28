import type { Env, MiddlewareHandler } from 'hono';
import { CONTEXT_KEYS } from '../core/context-keys';
import type { StorageEnv, StorageMiddlewareConfig } from './types';

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
 * import {
 *   createStorageMiddleware,
 *   MemoryRateLimitStorage,
 *   MemoryCacheStorage,
 * } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * // Inject storage instances into context
 * app.use('/*', createStorageMiddleware({
 *   rateLimitStorage: new MemoryRateLimitStorage(),
 *   cacheStorage: new MemoryCacheStorage(),
 *   loggingStorage: new MemoryLoggingStorage(),
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
    // Inject each configured storage into context
    if (config.loggingStorage) {
      ctx.set(CONTEXT_KEYS.loggingStorage, config.loggingStorage);
    }

    if (config.auditStorage) {
      ctx.set(CONTEXT_KEYS.auditStorage, config.auditStorage);
    }

    if (config.versioningStorage) {
      ctx.set(CONTEXT_KEYS.versioningStorage, config.versioningStorage);
    }

    if (config.apiKeyStorage) {
      ctx.set(CONTEXT_KEYS.apiKeyStorage, config.apiKeyStorage);
    }

    if (config.eventEmitter) {
      ctx.set(CONTEXT_KEYS.eventEmitter, config.eventEmitter);
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
