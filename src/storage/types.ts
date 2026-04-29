import type { Env } from 'hono';
import type { RateLimitStorage } from '../rate-limit/types';
import type { LoggingStorage } from '../logging/types';
import type { CacheStorage } from '../cache/types';
import type { AuditLogStorage } from '../core/audit';
import type { VersioningStorage } from '../core/versioning';
import type { MemoryAPIKeyStorage } from '../auth/storage/memory';
import type { IdempotencyStorage } from '../idempotency/types';
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
    rateLimitStorage?: RateLimitStorage;
    loggingStorage?: LoggingStorage;
    cacheStorage?: CacheStorage;
    auditStorage?: AuditLogStorage;
    versioningStorage?: VersioningStorage;
    apiKeyStorage?: MemoryAPIKeyStorage;
    idempotencyStorage?: IdempotencyStorage;
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
   * Rate limit storage instance.
   * If provided, will be available as `ctx.var.rateLimitStorage`.
   */
  rateLimitStorage?: RateLimitStorage;

  /**
   * Logging storage instance.
   * If provided, will be available as `ctx.var.loggingStorage`.
   */
  loggingStorage?: LoggingStorage;

  /**
   * Cache storage instance.
   * If provided, will be available as `ctx.var.cacheStorage`.
   */
  cacheStorage?: CacheStorage;

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
  apiKeyStorage?: MemoryAPIKeyStorage;

  /**
   * Idempotency storage instance.
   * If provided, will be available as `ctx.var.idempotencyStorage`.
   */
  idempotencyStorage?: IdempotencyStorage;

  /**
   * CRUD event emitter instance.
   * If provided, will be available as `ctx.var.eventEmitter`.
   */
  eventEmitter?: CrudEventEmitter;
}
