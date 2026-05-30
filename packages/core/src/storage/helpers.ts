import type { Context, Env } from 'hono';
import type { AuditLogStorage } from '../audit';
import { auditStorageRegistry } from '../audit';
import { apiKeyStorageRegistry } from '../auth/storage/memory';
import type { APIKeyStorage } from '../auth/types';
import { loggingStorageRegistry } from '../logging/middleware';
import type { LoggingStorage } from '../logging/types';
import type { VersioningStorage } from '../versioning';
import { versioningStorageRegistry } from '../versioning';
import type { StorageEnv } from './types';

// Re-export getters for backward compatibility (used by other modules)
export { getLoggingStorage } from '../logging/middleware';
export { getAuditStorage } from '../audit';
export { getVersioningStorage } from '../versioning';
export { getAPIKeyStorage } from '../auth/storage/memory';

// ============================================================================
// Type-Safe Context Variable Access
// ============================================================================

/**
 * Storage variable keys that can be accessed from context.
 */
type StorageKey = keyof StorageEnv['Variables'];

/**
 * Get a storage variable from context using Hono's typed pattern.
 * This is a type-safe alternative to the old getContextVar helper.
 *
 * @param ctx - The Hono context (must be typed with StorageEnv or compatible)
 * @param key - The storage key to retrieve
 * @returns The storage instance or undefined
 *
 * @example
 * ```ts
 * const app = new Hono<StorageEnv>();
 *
 * app.get('/test', (ctx) => {
 *   // Option 1: Direct typed access via c.var
 *   const storage1 = ctx.var.rateLimitStorage;
 *
 *   // Option 2: Using the helper (for generic contexts)
 *   const storage2 = getStorage(ctx, 'rateLimitStorage');
 * });
 * ```
 */
export function getStorage<K extends StorageKey>(
  ctx: Context<StorageEnv>,
  key: K,
): StorageEnv['Variables'][K] {
  return ctx.var[key];
}

// ============================================================================
// Storage Resolution Functions
// All delegate to their respective StorageRegistry.resolve() method which
// implements the priority chain: explicit param > context variable > global.
// ============================================================================

/**
 * Resolves logging storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage or null if none available
 */
export function resolveLoggingStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: LoggingStorage,
): LoggingStorage | null {
  return loggingStorageRegistry.resolve(ctx, explicitStorage);
}

/**
 * Resolves audit storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export function resolveAuditStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: AuditLogStorage,
): AuditLogStorage | null {
  return auditStorageRegistry.resolve(ctx, explicitStorage);
}

/**
 * Resolves versioning storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export function resolveVersioningStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: VersioningStorage,
): VersioningStorage | null {
  return versioningStorageRegistry.resolve(ctx, explicitStorage);
}

/**
 * Resolves API key storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export function resolveAPIKeyStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: APIKeyStorage,
): APIKeyStorage | null {
  return apiKeyStorageRegistry.resolve(ctx, explicitStorage);
}
