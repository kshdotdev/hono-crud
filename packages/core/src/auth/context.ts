/**
 * Auth-flavored Hono context accessors: user identity, roles, permissions
 * and auth type, as written by the auth middleware family.
 *
 * Generic helpers (`getContextVar`, `setContextVar`, `getRequestId`,
 * `getTenantId`) live in `src/utils/context.ts`.
 */

import type { Context, Env } from 'hono';
import { CONTEXT_KEYS } from '../core/context-keys';
import { getContextVar } from '../utils/context';

// `getUserId` is the lower-level shared accessor in `utils/request-info.ts`
// (also consumed by logging/audit). Re-exported here as part of the auth
// accessor family so there is a single definition.
export { getUserId } from '../utils/request-info';

export function getUser<E extends Env>(
  ctx: Context<E>,
): { id: string; roles?: string[]; permissions?: string[] } | undefined {
  return getContextVar<{ id: string; roles?: string[]; permissions?: string[] }>(
    ctx,
    CONTEXT_KEYS.user,
  );
}

export function getUserRoles<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, CONTEXT_KEYS.roles);
}

export function getUserPermissions<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, CONTEXT_KEYS.permissions);
}

export function getAuthType<E extends Env>(
  ctx: Context<E>,
): 'jwt' | 'api-key' | 'none' | undefined {
  return getContextVar<'jwt' | 'api-key' | 'none'>(ctx, CONTEXT_KEYS.authType);
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
  requiredPermissions: string[],
): boolean {
  const permissions = getUserPermissions(ctx);
  if (!permissions) return false;
  return requiredPermissions.every((perm) => permissions.includes(perm));
}
