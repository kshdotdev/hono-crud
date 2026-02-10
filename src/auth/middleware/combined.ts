import type { MiddlewareHandler } from 'hono';
import type { AuthEnv, AuthConfig, PathPattern } from '../types';
import { UnauthorizedException } from '../../core/exceptions';
import { createJWTMiddleware } from './jwt';
import { createAPIKeyMiddleware } from './api-key';

// ============================================================================
// Path Matching
// ============================================================================

/**
 * Checks if a path matches a pattern.
 */
function matchPath(path: string, pattern: PathPattern): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(path);
  }

  // Handle wildcards
  if (pattern.includes('*')) {
    // ** matches any number of path segments
    if (pattern.includes('**')) {
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      return new RegExp(`^${regexPattern}$`).test(path);
    }

    // * matches a single path segment
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regexPattern}$`).test(path);
  }

  // Exact match
  return path === pattern;
}

/**
 * Checks if a path should skip authentication.
 */
function shouldSkipPath(path: string, skipPaths: PathPattern[]): boolean {
  return skipPaths.some((pattern) => matchPath(path, pattern));
}

// ============================================================================
// Combined Auth Middleware
// ============================================================================

/**
 * Creates combined authentication middleware that tries multiple auth methods.
 *
 * @example
 * ```ts
 * const app = new Hono<AuthEnv>();
 *
 * app.use('*', createAuthMiddleware({
 *   jwt: { secret: process.env.JWT_SECRET! },
 *   apiKey: {
 *     lookupKey: async (hash) => await db.apiKeys.findByHash(hash),
 *   },
 *   skipPaths: ['/health', '/docs/*'],
 * }));
 *
 * app.get('/me', (c) => {
 *   return c.json({
 *     userId: c.var.userId,
 *     authType: c.var.authType,
 *   });
 * });
 * ```
 */
export function createAuthMiddleware<E extends AuthEnv = AuthEnv>(
  config: AuthConfig
): MiddlewareHandler<E> {
  const requireAuth = config.requireAuth ?? true;
  const skipPaths = config.skipPaths || [];
  const unauthorizedMessage = config.unauthorizedMessage || 'Unauthorized';
  const authOrder = config.authOrder || ['jwt', 'api-key'];

  // Create individual middleware instances
  const jwtMiddleware = config.jwt ? createJWTMiddleware<E>(config.jwt) : null;
  const apiKeyMiddleware = config.apiKey ? createAPIKeyMiddleware<E>(config.apiKey) : null;

  return async (ctx, next) => {
    // Check if path should skip auth
    const path = ctx.req.path;
    if (shouldSkipPath(path, skipPaths)) {
      ctx.set('authType', 'none');
      return next();
    }

    // Try each auth method in order
    let authenticated = false;
    let lastError: Error | null = null;

    for (const method of authOrder) {
      try {
        if (method === 'jwt' && jwtMiddleware) {
          // Check if there's a JWT token (Authorization: Bearer header)
          const authHeader = ctx.req.header('Authorization');
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            await jwtMiddleware(ctx, async () => {});
            authenticated = true;
            break;
          }
        }

        if (method === 'api-key' && apiKeyMiddleware) {
          // Check if there's an API key
          const headerName = config.apiKey?.headerName || 'X-API-Key';
          const queryParam = config.apiKey?.queryParam;
          const hasApiKey =
            ctx.req.header(headerName) || (queryParam && ctx.req.query(queryParam));

          if (hasApiKey) {
            await apiKeyMiddleware(ctx, async () => {});
            authenticated = true;
            break;
          }
        }
      } catch (error) {
        // Store the error but try the next method
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // If not authenticated and auth is required, throw error
    if (!authenticated) {
      if (requireAuth) {
        if (lastError instanceof UnauthorizedException) {
          throw lastError;
        }
        throw new UnauthorizedException(unauthorizedMessage);
      }
      // Auth not required, set auth type to none
      ctx.set('authType', 'none');
    }

    await next();
  };
}

/**
 * Creates optional authentication middleware.
 * Sets user info if authentication is present, but allows unauthenticated access.
 *
 * @example
 * ```ts
 * app.use('*', optionalAuth({
 *   jwt: { secret: process.env.JWT_SECRET! },
 * }));
 *
 * app.get('/public', (c) => {
 *   const userId = c.var.userId; // May be undefined
 *   return c.json({ authenticated: !!userId });
 * });
 * ```
 */
export function optionalAuth<E extends AuthEnv = AuthEnv>(
  config: Omit<AuthConfig, 'requireAuth'>
): MiddlewareHandler<E> {
  return createAuthMiddleware<E>({
    ...config,
    requireAuth: false,
  });
}

/**
 * Creates middleware that requires authentication.
 * Throws UnauthorizedException if no valid authentication is provided.
 *
 * This is a convenience wrapper around createAuthMiddleware with requireAuth: true.
 */
export function requireAuthentication<E extends AuthEnv = AuthEnv>(
  config: Omit<AuthConfig, 'requireAuth'>
): MiddlewareHandler<E> {
  return createAuthMiddleware<E>({
    ...config,
    requireAuth: true,
  });
}
