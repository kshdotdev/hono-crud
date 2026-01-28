import type { Context, Env } from 'hono';

/**
 * Type-safe context variable accessors.
 * Provides safe access to context variables with proper typing.
 */

/**
 * Safely retrieves a variable from the Hono context.
 * Returns undefined if the variable doesn't exist or context is invalid.
 *
 * @param ctx - Hono context (can be any Env type)
 * @param key - The variable key to retrieve
 * @returns The variable value or undefined
 *
 * @example
 * ```ts
 * const userId = getContextVar<string>(ctx, 'userId');
 * if (userId) {
 *   // User is authenticated
 * }
 * ```
 */
export function getContextVar<T>(ctx: unknown, key: string): T | undefined {
  // Access via .var property and cast through unknown for type safety
  const ctxObj = ctx as { var?: Record<string, unknown> };
  return ctxObj?.var?.[key] as T | undefined;
}

/**
 * Type-safe setter for context variables in middleware.
 * Used internally to set variables when the generic Env type
 * may not include the specific variable keys.
 *
 * @param ctx - Hono context (can be any Env type)
 * @param key - The variable key to set
 * @param value - The value to set
 *
 * @example
 * ```ts
 * // In middleware where E may not include 'requestId'
 * setContextVar(ctx, 'requestId', generateRequestId());
 * ```
 */
export function setContextVar<E extends Env>(ctx: Context<E>, key: string, value: unknown): void {
  (ctx as unknown as { set: (key: string, value: unknown) => void }).set(key, value);
}

/**
 * Retrieves the authenticated user ID from context.
 * Set by JWT or API key authentication middleware.
 *
 * @param ctx - Hono context
 * @returns The user ID or undefined if not authenticated
 */
export function getUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'userId');
}

/**
 * Retrieves the authenticated user object from context.
 * Set by JWT or API key authentication middleware.
 *
 * @param ctx - Hono context
 * @returns The user object or undefined if not authenticated
 */
export function getUser<E extends Env>(ctx: Context<E>): { id: string; roles?: string[]; permissions?: string[] } | undefined {
  return getContextVar<{ id: string; roles?: string[]; permissions?: string[] }>(ctx, 'user');
}

/**
 * Retrieves the user's roles from context.
 * Set by JWT or API key authentication middleware.
 *
 * @param ctx - Hono context
 * @returns The roles array or undefined
 */
export function getUserRoles<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, 'roles');
}

/**
 * Retrieves the user's permissions from context.
 * Set by JWT or API key authentication middleware.
 *
 * @param ctx - Hono context
 * @returns The permissions array or undefined
 */
export function getUserPermissions<E extends Env>(ctx: Context<E>): string[] | undefined {
  return getContextVar<string[]>(ctx, 'permissions');
}

/**
 * Retrieves the authentication type from context.
 * Set by authentication middleware.
 *
 * @param ctx - Hono context
 * @returns The auth type ('jwt' | 'api-key' | 'none') or undefined
 */
export function getAuthType<E extends Env>(ctx: Context<E>): 'jwt' | 'api-key' | 'none' | undefined {
  return getContextVar<'jwt' | 'api-key' | 'none'>(ctx, 'authType');
}

/**
 * Retrieves the tenant ID from context.
 * Set by multi-tenant middleware.
 *
 * @param ctx - Hono context
 * @param key - Custom context key (default: 'tenantId')
 * @returns The tenant ID or undefined
 */
export function getTenantId<E extends Env>(ctx: Context<E>, key: string = 'tenantId'): string | undefined {
  return getContextVar<string>(ctx, key);
}

/**
 * Retrieves the request ID from context.
 * Set by logging middleware.
 *
 * @param ctx - Hono context
 * @returns The request ID or undefined
 */
export function getRequestId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'requestId');
}

/**
 * Checks if a user has a specific role.
 *
 * @param ctx - Hono context
 * @param role - The role to check
 * @returns True if the user has the role
 */
export function hasRole<E extends Env>(ctx: Context<E>, role: string): boolean {
  const roles = getUserRoles(ctx);
  return roles?.includes(role) ?? false;
}

/**
 * Checks if a user has a specific permission.
 *
 * @param ctx - Hono context
 * @param permission - The permission to check
 * @returns True if the user has the permission
 */
export function hasPermission<E extends Env>(ctx: Context<E>, permission: string): boolean {
  const permissions = getUserPermissions(ctx);
  return permissions?.includes(permission) ?? false;
}

/**
 * Checks if a user has all specified roles.
 *
 * @param ctx - Hono context
 * @param requiredRoles - The roles to check
 * @returns True if the user has all roles
 */
export function hasAllRoles<E extends Env>(ctx: Context<E>, requiredRoles: string[]): boolean {
  const roles = getUserRoles(ctx);
  if (!roles) return false;
  return requiredRoles.every(role => roles.includes(role));
}

/**
 * Checks if a user has any of the specified roles.
 *
 * @param ctx - Hono context
 * @param requiredRoles - The roles to check
 * @returns True if the user has at least one role
 */
export function hasAnyRole<E extends Env>(ctx: Context<E>, requiredRoles: string[]): boolean {
  const roles = getUserRoles(ctx);
  if (!roles) return false;
  return requiredRoles.some(role => roles.includes(role));
}

/**
 * Checks if a user has all specified permissions.
 *
 * @param ctx - Hono context
 * @param requiredPermissions - The permissions to check
 * @returns True if the user has all permissions
 */
export function hasAllPermissions<E extends Env>(ctx: Context<E>, requiredPermissions: string[]): boolean {
  const permissions = getUserPermissions(ctx);
  if (!permissions) return false;
  return requiredPermissions.every(perm => permissions.includes(perm));
}
