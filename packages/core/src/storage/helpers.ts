import type { Context } from 'hono';
import type { StorageEnv } from './types';

// Re-export the storage-feature getters/resolvers from their home feature
// modules. Each feature module is the single canonical definition site (the
// quartet lives next to its `createStorageFeature` call); this barrel keeps
// the storage subpath offering the whole family in one place.
export {
  getLoggingStorage,
  getLoggingStorageRequired,
  resolveLoggingStorage,
} from '../logging/middleware';
export { getAuditStorage, getAuditStorageRequired, resolveAuditStorage } from '../audit';
export {
  getVersioningStorage,
  getVersioningStorageRequired,
  resolveVersioningStorage,
} from '../versioning';
export {
  getAPIKeyStorage,
  getAPIKeyStorageRequired,
  resolveAPIKeyStorage,
} from '../auth/storage/memory';

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
