import type { Env, MiddlewareHandler } from 'hono';
import type { LoggingStorage } from './logging/types';
import type { AuditLogStorage } from './audit';
import type { VersioningStorage } from './versioning';
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
 * import { createCrudMiddleware, MemoryAuditLogStorage } from 'hono-crud';
 *
 * app.use('*', async (c, next) => {
 *   const audit = new MemoryAuditLogStorage();
 *   return createCrudMiddleware({ audit })(c, next);
 * });
 * ```
 */
export interface CrudMiddlewareConfig {
  /** Audit log storage instance. */
  audit?: AuditLogStorage;
  /** Versioning storage instance. */
  versioning?: VersioningStorage;
  /** Logging storage instance. */
  logging?: LoggingStorage;
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
    if (config.audit) c.set('auditStorage', config.audit);
    if (config.versioning) c.set('versioningStorage', config.versioning);
    if (config.logging) c.set('loggingStorage', config.logging);
    if (config.events) c.set('eventEmitter', config.events);
    await next();
  };
}
