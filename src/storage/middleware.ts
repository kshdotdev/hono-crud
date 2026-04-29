import type { Env, MiddlewareHandler } from 'hono';
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
  config: StorageMiddlewareConfig
): MiddlewareHandler<E & StorageEnv> {
  return async (ctx, next) => {
    // Inject each configured storage into context
    if (config.rateLimitStorage) {
      ctx.set('rateLimitStorage', config.rateLimitStorage);
    }

    if (config.loggingStorage) {
      ctx.set('loggingStorage', config.loggingStorage);
    }

    if (config.cacheStorage) {
      ctx.set('cacheStorage', config.cacheStorage);
    }

    if (config.auditStorage) {
      ctx.set('auditStorage', config.auditStorage);
    }

    if (config.versioningStorage) {
      ctx.set('versioningStorage', config.versioningStorage);
    }

    if (config.apiKeyStorage) {
      ctx.set('apiKeyStorage', config.apiKeyStorage);
    }

    if (config.idempotencyStorage) {
      ctx.set('idempotencyStorage', config.idempotencyStorage);
    }

    if (config.eventEmitter) {
      ctx.set('eventEmitter', config.eventEmitter);
    }

    await next();
  };
}

/**
 * Creates middleware that injects only rate limit storage.
 *
 * @param storage - Rate limit storage instance
 * @returns Middleware handler
 *
 * @example
 * ```ts
 * import { createRateLimitStorageMiddleware, MemoryRateLimitStorage } from 'hono-crud';
 *
 * app.use('/*', createRateLimitStorageMiddleware(new MemoryRateLimitStorage()));
 * ```
 */
export function createRateLimitStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['rateLimitStorage']>
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ rateLimitStorage: storage });
}

/**
 * Creates middleware that injects only logging storage.
 *
 * @param storage - Logging storage instance
 * @returns Middleware handler
 */
export function createLoggingStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['loggingStorage']>
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ loggingStorage: storage });
}

/**
 * Creates middleware that injects only cache storage.
 *
 * @param storage - Cache storage instance
 * @returns Middleware handler
 */
export function createCacheStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['cacheStorage']>
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ cacheStorage: storage });
}

/**
 * Creates middleware that injects only audit storage.
 *
 * @param storage - Audit storage instance
 * @returns Middleware handler
 */
export function createAuditStorageMiddleware<E extends Env = Env>(
  storage: NonNullable<StorageMiddlewareConfig['auditStorage']>
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
  storage: NonNullable<StorageMiddlewareConfig['versioningStorage']>
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
  storage: NonNullable<StorageMiddlewareConfig['apiKeyStorage']>
): MiddlewareHandler<E & StorageEnv> {
  return createStorageMiddleware({ apiKeyStorage: storage });
}
