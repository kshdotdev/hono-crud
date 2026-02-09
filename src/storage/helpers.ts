import type { Context, Env } from 'hono';
import type { RateLimitStorage } from '../rate-limit/types';
import type { LoggingStorage } from '../logging/types';
import type { CacheStorage } from '../cache/types';
import type { AuditLogStorage } from '../core/audit';
import type { VersioningStorage } from '../core/versioning';
import type { MemoryAPIKeyStorage } from '../auth/storage/memory';
import type { StorageEnv } from './types';
import { rateLimitStorageRegistry } from '../rate-limit/middleware';
import { loggingStorageRegistry } from '../logging/middleware';
import { cacheStorageRegistry } from '../cache/mixin';
import { auditStorageRegistry } from '../core/audit';
import { versioningStorageRegistry } from '../core/versioning';
import { apiKeyStorageRegistry } from '../auth/storage/memory';

// Re-export getters for backward compatibility (used by other modules)
export { getRateLimitStorage } from '../rate-limit/middleware';
export { getLoggingStorage } from '../logging/middleware';
export { getCacheStorage } from '../cache/mixin';
export { getAuditStorage } from '../core/audit';
export { getVersioningStorage } from '../core/versioning';
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
  key: K
): StorageEnv['Variables'][K] {
  return ctx.var[key];
}

/**
 * @deprecated Use `ctx.var[key]` directly for typed access, or `getStorage()` helper.
 * This function is kept for backwards compatibility.
 *
 * Helper to safely access context variables.
 * For new code, prefer using Hono's typed `c.var` pattern with StorageEnv.
 */
export function getContextVar<T>(ctx: unknown, key: string): T | undefined {
  // Access via .var property
  const ctxObj = ctx as { var?: Record<string, unknown> };
  return ctxObj?.var?.[key] as T | undefined;
}

// ============================================================================
// Storage Resolution Functions
// All delegate to their respective StorageRegistry.resolve() method which
// implements the priority chain: explicit param > context variable > global.
// ============================================================================

/**
 * Resolves rate limit storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context (use StorageEnv for type safety)
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage or null if none available
 */
export function resolveRateLimitStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: RateLimitStorage
): RateLimitStorage | null {
  return rateLimitStorageRegistry.resolve(ctx, explicitStorage);
}

/**
 * Resolves logging storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage or null if none available
 */
export function resolveLoggingStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: LoggingStorage
): LoggingStorage | null {
  return loggingStorageRegistry.resolve(ctx, explicitStorage);
}

/**
 * Resolves cache storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage (defaults to global MemoryCacheStorage)
 */
export function resolveCacheStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: CacheStorage
): CacheStorage {
  return cacheStorageRegistry.resolve(ctx, explicitStorage) ?? cacheStorageRegistry.getRequired();
}

/**
 * Resolves audit storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage (defaults to global MemoryAuditLogStorage)
 */
export function resolveAuditStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: AuditLogStorage
): AuditLogStorage {
  return auditStorageRegistry.resolve(ctx, explicitStorage) ?? auditStorageRegistry.getRequired();
}

/**
 * Resolves versioning storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage (defaults to global MemoryVersioningStorage)
 */
export function resolveVersioningStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: VersioningStorage
): VersioningStorage {
  return versioningStorageRegistry.resolve(ctx, explicitStorage) ?? versioningStorageRegistry.getRequired();
}

/**
 * Resolves API key storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage (defaults to global MemoryAPIKeyStorage)
 */
export function resolveAPIKeyStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: MemoryAPIKeyStorage
): MemoryAPIKeyStorage {
  return apiKeyStorageRegistry.resolve(ctx, explicitStorage) ?? apiKeyStorageRegistry.getRequired();
}
