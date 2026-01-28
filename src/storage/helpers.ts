import type { Context, Env } from 'hono';
import type { RateLimitStorage } from '../rate-limit/types.js';
import type { LoggingStorage } from '../logging/types.js';
import type { CacheStorage } from '../cache/types.js';
import type { AuditLogStorage } from '../core/audit.js';
import type { VersioningStorage } from '../core/versioning.js';
import type { MemoryAPIKeyStorage } from '../auth/storage/memory.js';
import type { StorageEnv } from './types.js';
import { getRateLimitStorage } from '../rate-limit/middleware.js';
import { getLoggingStorage } from '../logging/middleware.js';
import { getCacheStorage } from '../cache/mixin.js';
import { getAuditStorage } from '../core/audit.js';
import { getVersioningStorage } from '../core/versioning.js';
import { getAPIKeyStorage } from '../auth/storage/memory.js';

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
// ============================================================================

/**
 * Resolves rate limit storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context (use StorageEnv for type safety)
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage or null if none available
 *
 * @example
 * ```ts
 * // In middleware with typed context
 * const app = new Hono<StorageEnv>();
 * app.use('/*', async (ctx, next) => {
 *   const storage = resolveRateLimitStorage(ctx);
 *   if (!storage) {
 *     console.warn('No rate limit storage configured');
 *   }
 *   await next();
 * });
 *
 * // With explicit storage
 * const storage = resolveRateLimitStorage(ctx, myCustomStorage);
 * ```
 */
export function resolveRateLimitStorage<E extends Env>(
  ctx?: Context<E>,
  explicitStorage?: RateLimitStorage
): RateLimitStorage | null {
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<RateLimitStorage>(ctx, 'rateLimitStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage
  return getRateLimitStorage();
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
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<LoggingStorage>(ctx, 'loggingStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage
  return getLoggingStorage();
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
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<CacheStorage>(ctx, 'cacheStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage (always returns a default)
  return getCacheStorage();
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
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<AuditLogStorage>(ctx, 'auditStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage (always returns a default)
  return getAuditStorage();
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
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<VersioningStorage>(ctx, 'versioningStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage (always returns a default)
  return getVersioningStorage();
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
  // Priority 1: Explicit parameter
  if (explicitStorage) return explicitStorage;

  // Priority 2: Context variable
  if (ctx) {
    const ctxStorage = getContextVar<MemoryAPIKeyStorage>(ctx, 'apiKeyStorage');
    if (ctxStorage) return ctxStorage;
  }

  // Priority 3: Global storage (always returns a default)
  return getAPIKeyStorage();
}
