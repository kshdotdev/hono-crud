import type { Context, MiddlewareHandler } from 'hono';
import { CONTEXT_KEYS } from '../../core/context-keys';
import { ConfigurationException, UnauthorizedException } from '../../core/exceptions';
import { resolveAPIKeyStorage } from '../../storage/helpers';
import { hashAPIKey } from '../hash';
import type { APIKeyConfig, APIKeyEntry, APIKeyLookupResult, AuthEnv, AuthUser } from '../types';
import { validateAPIKeyEntry } from '../validators/api-key';

// ============================================================================
// API Key Utilities
// ============================================================================

/**
 * Alias of {@link hashAPIKey}; the default `hashKey` used by
 * createAPIKeyMiddleware/validateAPIKey.
 */
export const defaultHashAPIKey = hashAPIKey;

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
  config: APIKeyConfig,
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

    // Resolve the lookup source (priority: lookupKey > resolved storage).
    let lookupResult: APIKeyLookupResult;
    const storage = config.lookupKey ? null : resolveAPIKeyStorage(ctx, config.storage);
    if (config.lookupKey) {
      lookupResult = await config.lookupKey(keyHash);
    } else if (storage) {
      lookupResult = await storage.lookup(keyHash);
    } else {
      throw new ConfigurationException(
        'API key auth requires lookupKey, storage, or a configured apiKeyStorage',
      );
    }
    const entry = validateAPIKeyEntry(lookupResult);

    // Extract user info
    const user = extractUser(entry);

    // Set context variables
    ctx.set(CONTEXT_KEYS.userId, user.id);
    ctx.set(CONTEXT_KEYS.user, user);
    ctx.set(CONTEXT_KEYS.roles, user.roles || []);
    ctx.set(CONTEXT_KEYS.permissions, user.permissions || []);
    ctx.set(CONTEXT_KEYS.authType, 'api-key');

    // Fire-and-forget update last used timestamp
    if (config.updateLastUsed) {
      Promise.resolve(config.updateLastUsed(entry.id)).catch(() => {
        // Silently ignore errors updating last used
      });
    } else if (storage) {
      Promise.resolve(storage.updateLastUsed(entry.id)).catch(() => {
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
export async function validateAPIKey(apiKey: string, config: APIKeyConfig): Promise<APIKeyEntry> {
  const hashKey = config.hashKey || defaultHashAPIKey;

  // Hash the API key
  const keyHash = await hashKey(apiKey);

  // Resolve the lookup source (priority: lookupKey > resolved storage). No ctx
  // here, so storage resolution uses explicit > global only.
  let lookupResult: APIKeyLookupResult;
  if (config.lookupKey) {
    lookupResult = await config.lookupKey(keyHash);
  } else {
    const storage = resolveAPIKeyStorage(undefined, config.storage);
    if (storage) {
      lookupResult = await storage.lookup(keyHash);
    } else {
      throw new ConfigurationException(
        'API key auth requires lookupKey, storage, or a configured apiKeyStorage',
      );
    }
  }
  return validateAPIKeyEntry(lookupResult);
}
