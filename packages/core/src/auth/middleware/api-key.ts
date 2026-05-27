import type { Context, MiddlewareHandler } from 'hono';
import type { AuthEnv, APIKeyConfig, APIKeyEntry, AuthUser } from '../types';
import { UnauthorizedException } from '../../core/exceptions';
import { validateAPIKeyEntry } from '../validators/api-key';

// ============================================================================
// API Key Utilities
// ============================================================================

/**
 * Default function to hash an API key using SHA-256.
 */
export async function defaultHashAPIKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Default function to extract user info from API key entry.
 */
function defaultExtractUser(entry: APIKeyEntry): AuthUser {
  return {
    id: entry.userId,
    roles: entry.roles,
    permissions: entry.permissions,
    metadata: {
      ...entry.metadata,
      apiKeyId: entry.id,
      apiKeyName: entry.name,
    },
  };
}

/**
 * Extract API key from request headers.
 */
function extractFromHeader(ctx: Context, headerName: string): string | null {
  return ctx.req.header(headerName) || null;
}

/**
 * Extract API key from query parameters.
 */
function extractFromQuery(ctx: Context, paramName: string): string | null {
  const value = ctx.req.query(paramName);
  return value || null;
}

// ============================================================================
// API Key Middleware
// ============================================================================

/**
 * Creates API key authentication middleware.
 *
 * @example
 * ```ts
 * const app = new Hono<AuthEnv>();
 *
 * app.use('*', createAPIKeyMiddleware({
 *   lookupKey: async (hash) => {
 *     return await db.apiKeys.findUnique({ where: { keyHash: hash } });
 *   },
 * }));
 *
 * app.get('/data', (c) => {
 *   return c.json({ userId: c.var.userId });
 * });
 * ```
 */
export function createAPIKeyMiddleware<E extends AuthEnv = AuthEnv>(
  config: APIKeyConfig
): MiddlewareHandler<E> {
  const headerName = config.headerName || 'X-API-Key';
  const queryParam = config.queryParam ?? null;
  const hashKey = config.hashKey || defaultHashAPIKey;
  const extractUser = config.extractUser || defaultExtractUser;

  return async (ctx, next) => {
    // Try to extract API key from header first, then query param
    let apiKey = extractFromHeader(ctx as unknown as Context, headerName);
    if (!apiKey && queryParam) {
      apiKey = extractFromQuery(ctx as unknown as Context, queryParam);
    }

    if (!apiKey) {
      throw new UnauthorizedException('Missing API key');
    }

    // Hash the API key
    const keyHash = await hashKey(apiKey);

    // Look up and validate the API key
    const lookupResult = await config.lookupKey(keyHash);
    const entry = validateAPIKeyEntry(lookupResult);

    // Extract user info
    const user = extractUser(entry);

    // Set context variables
    ctx.set('userId', user.id);
    ctx.set('user', user);
    ctx.set('roles', user.roles || []);
    ctx.set('permissions', user.permissions || []);
    ctx.set('authType', 'api-key');

    // Fire-and-forget update last used timestamp
    if (config.updateLastUsed) {
      Promise.resolve(config.updateLastUsed(entry.id)).catch(() => {
        // Silently ignore errors updating last used
      });
    }

    await next();
  };
}

/**
 * Validates an API key and returns the entry if valid.
 * Useful for manual API key validation outside of middleware.
 *
 * @param apiKey - The raw API key to validate
 * @param config - API key configuration
 * @returns The API key entry if valid
 * @throws UnauthorizedException if the key is invalid
 */
export async function validateAPIKey(
  apiKey: string,
  config: APIKeyConfig
): Promise<APIKeyEntry> {
  const hashKey = config.hashKey || defaultHashAPIKey;

  // Hash the API key
  const keyHash = await hashKey(apiKey);

  // Look up and validate the API key
  const lookupResult = await config.lookupKey(keyHash);
  return validateAPIKeyEntry(lookupResult);
}
