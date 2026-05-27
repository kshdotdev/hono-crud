import type { Env } from 'hono';
import type { LoggingStorage } from '../logging/types';
import type { AuditLogStorage } from '../audit';
import type { VersioningStorage } from '../versioning';
import type { APIKeyStorage } from '../auth/types';
import type { CrudEventEmitter } from '../events/emitter';

/**
 * Extended Hono environment with storage context variables.
 * Use this type when you want access to context-based storage.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { StorageEnv, createStorageMiddleware } from 'hono-crud';
 *
 * const app = new Hono<StorageEnv>();
 *
 * app.use('/*', createStorageMiddleware({
 *   rateLimitStorage: new MemoryRateLimitStorage(),
 * }));
 *
 * app.get('/test', (ctx) => {
 *   const storage = ctx.var.rateLimitStorage; // Typed!
 *   return ctx.text('ok');
 * });
 * ```
 */
export interface StorageEnv extends Env {
  Variables: {
    loggingStorage?: LoggingStorage;
    auditStorage?: AuditLogStorage;
    versioningStorage?: VersioningStorage;
    apiKeyStorage?: APIKeyStorage;
    eventEmitter?: CrudEventEmitter;
  };
}

/**
 * Configuration for the storage middleware.
 * Provide any storage instances you want injected into the Hono context.
 *
 * @example
 * ```ts
 * const config: StorageMiddlewareConfig = {
 *   rateLimitStorage: new MemoryRateLimitStorage(),
 *   cacheStorage: new MemoryCacheStorage(),
 * };
 * ```
 */
export interface StorageMiddlewareConfig {
  /**
   * Logging storage instance.
   * If provided, will be available as `ctx.var.loggingStorage`.
   */
  loggingStorage?: LoggingStorage;

  /**
   * Audit log storage instance.
   * If provided, will be available as `ctx.var.auditStorage`.
   */
  auditStorage?: AuditLogStorage;

  /**
   * Versioning storage instance.
   * If provided, will be available as `ctx.var.versioningStorage`.
   */
  versioningStorage?: VersioningStorage;

  /**
   * API key storage instance.
   * If provided, will be available as `ctx.var.apiKeyStorage`.
   */
  apiKeyStorage?: APIKeyStorage;

  /**
   * CRUD event emitter instance.
   * If provided, will be available as `ctx.var.eventEmitter`.
   */
  eventEmitter?: CrudEventEmitter;
}
