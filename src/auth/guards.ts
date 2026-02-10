import type { MiddlewareHandler } from 'hono';
import type { AuthEnv, AuthorizationCheck, OwnershipExtractor, Guard } from './types';
import { ForbiddenException, UnauthorizedException } from '../core/exceptions';

// ============================================================================
// Role Guards
// ============================================================================

/**
 * Creates a guard that requires the user to have at least one of the specified roles.
 *
 * @example
 * ```ts
 * app.use('/admin/*', requireRoles('admin', 'super-admin'));
 * ```
 */
export function requireRoles<E extends AuthEnv = AuthEnv>(
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRoles = user.roles || [];
    const hasRole = roles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException(
        `Required role: ${roles.join(' or ')}`
      );
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to have ALL of the specified roles.
 *
 * @example
 * ```ts
 * app.use('/super/*', requireAllRoles('admin', 'verified'));
 * ```
 */
export function requireAllRoles<E extends AuthEnv = AuthEnv>(
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRoles = user.roles || [];
    const hasAllRoles = roles.every((role) => userRoles.includes(role));

    if (!hasAllRoles) {
      throw new ForbiddenException(
        `Required roles: ${roles.join(' and ')}`
      );
    }

    await next();
  };
}

// ============================================================================
// Permission Guards
// ============================================================================

/**
 * Creates a guard that requires the user to have ALL of the specified permissions.
 *
 * @example
 * ```ts
 * app.use('/users/*', requirePermissions('users:read', 'users:write'));
 * ```
 */
export function requirePermissions<E extends AuthEnv = AuthEnv>(
  ...permissions: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userPermissions = user.permissions || [];
    const hasAllPermissions = permissions.every((perm) => userPermissions.includes(perm));

    if (!hasAllPermissions) {
      throw new ForbiddenException(
        `Required permissions: ${permissions.join(', ')}`
      );
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to have at least one of the specified permissions.
 *
 * @example
 * ```ts
 * app.use('/data/*', requireAnyPermission('data:read', 'data:admin'));
 * ```
 */
export function requireAnyPermission<E extends AuthEnv = AuthEnv>(
  ...permissions: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userPermissions = user.permissions || [];
    const hasAnyPermission = permissions.some((perm) => userPermissions.includes(perm));

    if (!hasAnyPermission) {
      throw new ForbiddenException(
        `Required permission: ${permissions.join(' or ')}`
      );
    }

    await next();
  };
}

// ============================================================================
// Custom Authorization Guards
// ============================================================================

/**
 * Creates a guard with a custom authorization check.
 *
 * @example
 * ```ts
 * app.use('/premium/*', requireAuth((user, ctx) => {
 *   return user.metadata?.subscription === 'premium';
 * }));
 * ```
 */
export function requireAuth<E extends AuthEnv = AuthEnv>(
  check: AuthorizationCheck<E>
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const isAuthorized = await check(user, ctx);
    if (!isAuthorized) {
      throw new ForbiddenException('Access denied');
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to own the resource.
 *
 * @example
 * ```ts
 * // Get owner ID from path params
 * app.use('/users/:id/*', requireOwnership((ctx) => ctx.req.param('id')));
 *
 * // Get owner ID from fetched resource
 * app.use('/posts/:id/*', requireOwnership(async (ctx) => {
 *   const post = await db.posts.findUnique({ where: { id: ctx.req.param('id') } });
 *   return post?.authorId || '';
 * }));
 * ```
 */
export function requireOwnership<E extends AuthEnv = AuthEnv>(
  getOwnerId: OwnershipExtractor<E>
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const ownerId = await getOwnerId(ctx);
    if (user.id !== ownerId) {
      throw new ForbiddenException('Access denied: not resource owner');
    }

    await next();
  };
}

/**
 * Creates a guard that allows access if the user owns the resource OR has admin role.
 *
 * @example
 * ```ts
 * app.use('/posts/:id/*', requireOwnershipOrRole(
 *   (ctx) => getPostAuthorId(ctx.req.param('id')),
 *   'admin'
 * ));
 * ```
 */
export function requireOwnershipOrRole<E extends AuthEnv = AuthEnv>(
  getOwnerId: OwnershipExtractor<E>,
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if user has required role
    const userRoles = user.roles || [];
    const hasRole = roles.some((role) => userRoles.includes(role));

    if (hasRole) {
      await next();
      return;
    }

    // Check if user is owner
    const ownerId = await getOwnerId(ctx);
    if (user.id === ownerId) {
      await next();
      return;
    }

    throw new ForbiddenException('Access denied: not resource owner and missing required role');
  };
}

// ============================================================================
// Guard Composition
// ============================================================================

/**
 * Creates a guard that requires ALL of the provided guards to pass (AND logic).
 *
 * @example
 * ```ts
 * app.use('/secure/*', allOf(
 *   requireRoles('admin'),
 *   requirePermissions('secure:access'),
 *   requireAuth((user) => user.metadata?.mfaEnabled === true)
 * ));
 * ```
 */
export function allOf<E extends AuthEnv = AuthEnv>(
  ...guards: Guard<E>[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    // Run all guards - if any throws, the request is rejected
    for (const guard of guards) {
      await guard(ctx, async () => {});
    }
    await next();
  };
}

/**
 * Creates a guard that requires ANY of the provided guards to pass (OR logic).
 *
 * @example
 * ```ts
 * app.use('/shared/*', anyOf(
 *   requireRoles('admin'),
 *   requireOwnership((ctx) => getResourceOwnerId(ctx)),
 *   requirePermissions('shared:access')
 * ));
 * ```
 */
export function anyOf<E extends AuthEnv = AuthEnv>(
  ...guards: Guard<E>[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    let lastError: Error | null = null;

    for (const guard of guards) {
      try {
        await guard(ctx, async () => {});
        // If any guard passes, allow the request
        await next();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // All guards failed
    if (lastError) {
      throw lastError;
    }
    throw new ForbiddenException('Access denied');
  };
}

// ============================================================================
// Utility Guards
// ============================================================================

/**
 * Creates a guard that denies access to everyone.
 * Useful for temporarily blocking routes.
 *
 * @example
 * ```ts
 * app.use('/maintenance/*', denyAll('Service temporarily unavailable'));
 * ```
 */
export function denyAll<E extends AuthEnv = AuthEnv>(
  message: string = 'Access denied'
): MiddlewareHandler<E> {
  return async () => {
    throw new ForbiddenException(message);
  };
}

/**
 * Creates a guard that allows access to everyone.
 * Useful for explicitly marking public routes.
 *
 * @example
 * ```ts
 * app.use('/public/*', allowAll());
 * ```
 */
export function allowAll<E extends AuthEnv = AuthEnv>(): MiddlewareHandler<E> {
  return async (_ctx, next) => {
    await next();
  };
}

/**
 * Creates a guard that only allows authenticated users.
 * Unlike other guards, this doesn't check roles or permissions.
 *
 * @example
 * ```ts
 * app.use('/api/*', requireAuthenticated());
 * ```
 */
export function requireAuthenticated<E extends AuthEnv = AuthEnv>(): MiddlewareHandler<E> {
  return async (ctx, next) => {
    if (!ctx.var.user) {
      throw new UnauthorizedException('Authentication required');
    }
    await next();
  };
}
