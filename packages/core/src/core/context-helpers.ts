/**
 * Context-variable accessors for Hono.
 *
 * Generic helpers (`getContextVar`, `setContextVar`, `getRequestId`,
 * `getTenantId`) live in `src/utils/context.ts` and are re-exported here
 * for backwards compatibility. Auth-specific helpers (user id / roles /
 * permissions / auth type) remain in this module until Phase E moves
 * them under `src/auth/context.ts`.
 */

import type { Context, Env } from 'hono';
import { getContextVar } from '../utils/context';

export {
  getContextVar,
  setContextVar,
  getRequestId,
  getTenantId,
} from '../utils/context';

// ============================================================================
// Auth-specific helpers (move to src/auth/context.ts in Phase E)
// ============================================================================

export function getUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'userId');
}

export function getUser<E extends Env>(
  ctx: Context<E>
): { id: string; roles?: string[]; permissions?: string[] } | undefined {
  return getContextVar<{ id: string; roles?: string[]; permissions?: string[] }>(ctx, 'user');
}

export function getUserRoles<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, 'roles');
}

export function getUserPermissions<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, 'permissions');
}

export function getAuthType<E extends Env>(
  ctx: Context<E>
): 'jwt' | 'api-key' | 'none' | undefined {
  return getContextVar<'jwt' | 'api-key' | 'none'>(ctx, 'authType');
}

export function hasRole<E extends Env>(ctx: Context<E>, role: string): boolean {
  const roles = getUserRoles(ctx);
  return roles?.includes(role) ?? false;
}

export function hasPermission<E extends Env>(ctx: Context<E>, permission: string): boolean {
  const permissions = getUserPermissions(ctx);
  return permissions?.includes(permission) ?? false;
}

export function hasAllRoles<E extends Env>(ctx: Context<E>, requiredRoles: string[]): boolean {
  const roles = getUserRoles(ctx);
  if (!roles) return false;
  return requiredRoles.every((role) => roles.includes(role));
}

export function hasAnyRole<E extends Env>(ctx: Context<E>, requiredRoles: string[]): boolean {
  const roles = getUserRoles(ctx);
  if (!roles) return false;
  return requiredRoles.some((role) => roles.includes(role));
}

export function hasAllPermissions<E extends Env>(
  ctx: Context<E>,
  requiredPermissions: string[]
): boolean {
  const permissions = getUserPermissions(ctx);
  if (!permissions) return false;
  return requiredPermissions.every((perm) => permissions.includes(perm));
}
