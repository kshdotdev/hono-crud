import type { Context, MiddlewareHandler } from 'hono';
import { ApiException } from '../core/exceptions';
import type {
  ApiVersionConfig,
  VersioningMiddlewareConfig,
} from './types';

/**
 * Extract version from the Accept-Version (or custom) header.
 */
function extractFromHeader(ctx: Context, headerName: string): string | undefined {
  return ctx.req.header(headerName) ?? undefined;
}

/**
 * Extract version from a query parameter.
 */
function extractFromQuery(ctx: Context, paramName: string): string | undefined {
  return ctx.req.query(paramName) ?? undefined;
}

/**
 * Extract version from the URL path (e.g. /v1/users → '1').
 */
function extractFromUrl(ctx: Context, pattern: string): string | undefined {
  const path = ctx.req.path;
  // Convert pattern like '/v{version}' to regex: /^\/v([^/]+)/
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace('\\{version\\}', '([^/]+)');
  const regex = new RegExp(`^${regexStr}`);
  const match = path.match(regex);
  return match?.[1];
}

/**
 * Create API versioning middleware.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { apiVersion } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * app.use('*', apiVersion({
 *   versions: [
 *     { version: '2', responseTransformer: (data) => data },
 *     {
 *       version: '1',
 *       deprecated: '2024-06-01',
 *       sunset: '2025-01-01',
 *       responseTransformer: (data) => {
 *         // Convert v2 response to v1 format
 *         const { firstName, lastName, ...rest } = data;
 *         return { ...rest, name: `${firstName} ${lastName}` };
 *       },
 *     },
 *   ],
 *   defaultVersion: '2',
 *   strategy: 'header',
 * }));
 * ```
 */
export function apiVersion(config: VersioningMiddlewareConfig): MiddlewareHandler {
  const {
    versions,
    strategy = 'header',
    headerName = 'Accept-Version',
    queryParam = 'version',
    urlPattern = '/v{version}',
    extractVersion: customExtractor,
    addHeaders = true,
  } = config;

  const defaultVersion = config.defaultVersion ?? versions[0]?.version;

  // Build a lookup map
  const versionMap = new Map<string, ApiVersionConfig>();
  for (const v of versions) {
    versionMap.set(v.version, v);
  }

  return async (ctx, next) => {
    // Extract version from request
    let version: string | undefined;

    if (customExtractor) {
      version = customExtractor(ctx);
    } else {
      switch (strategy) {
        case 'header':
          version = extractFromHeader(ctx, headerName);
          break;
        case 'query':
          version = extractFromQuery(ctx, queryParam);
          break;
        case 'url':
          version = extractFromUrl(ctx, urlPattern);
          break;
      }
    }

    // Fall back to default
    version = version ?? defaultVersion;

    if (!version) {
      throw new ApiException('API version is required', 400, 'VERSION_REQUIRED');
    }

    const versionConfig = versionMap.get(version);
    if (!versionConfig) {
      throw new ApiException(
        `Unsupported API version: ${version}`,
        400,
        'UNSUPPORTED_VERSION'
      );
    }

    // Set version info in context
    ctx.set('apiVersion', version);
    ctx.set('apiVersionConfig', versionConfig);

    // Add response headers
    if (addHeaders) {
      ctx.header('X-API-Version', version);

      if (versionConfig.deprecated) {
        ctx.header('Deprecation', versionConfig.deprecated);
      }

      if (versionConfig.sunset) {
        ctx.header('Sunset', versionConfig.sunset);
      }
    }

    // Apply version-specific middleware
    if (versionConfig.middleware && versionConfig.middleware.length > 0) {
      for (const mw of versionConfig.middleware) {
        await mw(ctx, async () => {});
      }
    }

    await next();
  };
}

/**
 * Get the current API version from context.
 */
export function getApiVersion(ctx: Context): string | undefined {
  return ctx.get('apiVersion');
}

/**
 * Get the full version config from context.
 */
export function getApiVersionConfig(ctx: Context): ApiVersionConfig | undefined {
  return ctx.get('apiVersionConfig');
}

/**
 * Middleware that transforms response JSON using the active version's responseTransformer.
 * Apply AFTER your route handlers.
 *
 * @example
 * ```ts
 * app.use('*', apiVersion({ ... }));
 * app.get('/users/:id', handler);
 * app.use('*', versionedResponse());
 * ```
 */
export function versionedResponse(): MiddlewareHandler {
  return async (ctx, next) => {
    await next();

    const versionConfig = ctx.get('apiVersionConfig') as ApiVersionConfig | undefined;
    if (!versionConfig?.responseTransformer) return;

    const contentType = ctx.res.headers.get('content-type');
    if (!contentType?.includes('application/json')) return;

    try {
      const body = await ctx.res.json();
      const transformed = versionConfig.responseTransformer(body as Record<string, unknown>);
      ctx.res = new Response(JSON.stringify(transformed), {
        status: ctx.res.status,
        headers: ctx.res.headers,
      });
    } catch {
      // If body can't be parsed as JSON, leave as-is
    }
  };
}
