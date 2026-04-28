import type { Env, MiddlewareHandler } from 'hono';
import type { CacheStorage } from './cache/types';
import type { RateLimitStorage } from './rate-limit/types';
import type { LoggingStorage } from './logging/types';
import type { AuditLogStorage } from './core/audit';
import type { VersioningStorage } from './core/versioning';
import type { IdempotencyStorage } from './idempotency/types';
import type { CrudEventEmitter } from './events/emitter';
import type { StorageEnv } from './storage/types';

/**
 * Unified configuration for hono-crud middleware.
 * Injects storage instances and event emitter into Hono context
 * so endpoints resolve them automatically (context > global fallback).
 *
 * This is the recommended approach for edge runtimes where bindings
 * (KV, D1, etc.) are only available inside request handlers.
 *
 * @example
 * ```ts
 * import { createCrudMiddleware, KVCacheStorage, KVRateLimitStorage } from 'hono-crud';
 *
 * app.use('*', async (c, next) => {
 *   const cache = new KVCacheStorage({ kv: c.env.CACHE_KV });
 *   const rateLimit = new KVRateLimitStorage({ kv: c.env.RATE_LIMIT_KV });
 *   return createCrudMiddleware({ cache, rateLimit })(c, next);
 * });
 * ```
 */
export interface CrudMiddlewareConfig {
  /** Cache storage instance. */
  cache?: CacheStorage;
  /** Rate limit storage instance. */
  rateLimit?: RateLimitStorage;
  /** Audit log storage instance. */
  audit?: AuditLogStorage;
  /** Versioning storage instance. */
  versioning?: VersioningStorage;
  /** Logging storage instance. */
  logging?: LoggingStorage;
  /** Idempotency storage instance. */
  idempotency?: IdempotencyStorage;
  /** Event emitter instance. */
  events?: CrudEventEmitter;
}

/**
 * Creates middleware that injects all hono-crud storage instances into context.
 * Endpoints resolve storage with priority: explicit param > context > global.
 *
 * @param config - Storage and emitter instances to inject
 * @returns Hono middleware handler
 */
export function createCrudMiddleware<E extends Env = Env>(
  config: CrudMiddlewareConfig
): MiddlewareHandler<E & StorageEnv> {
  return async (c, next) => {
    if (config.cache) c.set('cacheStorage', config.cache);
    if (config.rateLimit) c.set('rateLimitStorage', config.rateLimit);
    if (config.audit) c.set('auditStorage', config.audit);
    if (config.versioning) c.set('versioningStorage', config.versioning);
    if (config.logging) c.set('loggingStorage', config.logging);
    if (config.idempotency) c.set('idempotencyStorage', config.idempotency);
    if (config.events) c.set('eventEmitter', config.events);
    await next();
  };
}
