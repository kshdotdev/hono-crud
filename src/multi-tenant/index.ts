import type { Context, MiddlewareHandler, Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { setContextVar } from '../utils/context';

/**
 * Options for the multi-tenant middleware.
 */
export interface MultiTenantMiddlewareOptions {
  /**
   * How to extract the tenant ID from the request.
   * - 'header': From request header
   * - 'path': From URL path parameter
   * - 'query': From query string parameter
   * - 'jwt': From JWT claims (requires JWT middleware to run first)
   * - 'custom': Use a custom extraction function
   * @default 'header'
   */
  source?: 'header' | 'path' | 'query' | 'jwt' | 'custom';

  /**
   * Header name when source is 'header'.
   * @default 'X-Tenant-ID'
   */
  headerName?: string;

  /**
   * Path parameter name when source is 'path'.
   * @default 'tenantId'
   */
  pathParam?: string;

  /**
   * Query parameter name when source is 'query'.
   * @default 'tenantId'
   */
  queryParam?: string;

  /**
   * JWT claim name when source is 'jwt'.
   * @default 'tenantId'
   */
  jwtClaim?: string;

  /**
   * Custom function to extract tenant ID.
   * Only used when source is 'custom'.
   */
  extractor?: <E extends Env>(ctx: Context<E>) => string | undefined | Promise<string | undefined>;

  /**
   * The key to store the tenant ID in context.
   * Access via ctx.get('tenantId') or your custom key.
   * @default 'tenantId'
   */
  contextKey?: string;

  /**
   * Whether the tenant ID is required.
   * If true, requests without tenant ID will receive a 400 error.
   * @default true
   */
  required?: boolean;

  /**
   * Custom error message when tenant ID is missing.
   * @default 'Tenant ID is required'
   */
  errorMessage?: string;

  /**
   * Custom error handler for missing tenant ID.
   * If provided, this function is called instead of throwing an error.
   */
  onMissing?: <E extends Env>(ctx: Context<E>) => Response | Promise<Response>;

  /**
   * Validate the tenant ID.
   * Return true if valid, false or throw an error if invalid.
   */
  validate?: <E extends Env>(tenantId: string, ctx: Context<E>) => boolean | Promise<boolean>;

  /**
   * Custom error message when tenant ID is invalid.
   * @default 'Invalid tenant ID'
   */
  invalidMessage?: string;
}

/**
 * Creates a multi-tenant middleware that extracts tenant ID from requests
 * and makes it available in the Hono context.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { multiTenant } from 'hono-crud';
 *
 * const app = new Hono();
 *
 * // Extract tenant from header (default)
 * app.use('/*', multiTenant());
 *
 * // Extract tenant from URL path
 * app.use('/api/:tenantId/*', multiTenant({ source: 'path' }));
 *
 * // Extract tenant from JWT claims
 * app.use('/*', jwt({ secret: 'xxx' }));
 * app.use('/*', multiTenant({ source: 'jwt', jwtClaim: 'org_id' }));
 *
 * // Custom extraction
 * app.use('/*', multiTenant({
 *   source: 'custom',
 *   extractor: async (ctx) => {
 *     const user = await getUser(ctx);
 *     return user?.organizationId;
 *   },
 * }));
 *
 * // Access tenant ID in routes
 * app.get('/data', (c) => {
 *   const tenantId = c.get('tenantId');
 *   return c.json({ tenantId });
 * });
 * ```
 */
export function multiTenant<E extends Env = Env>(
  options: MultiTenantMiddlewareOptions = {}
): MiddlewareHandler<E> {
  const {
    source = 'header',
    headerName = 'X-Tenant-ID',
    pathParam = 'tenantId',
    queryParam = 'tenantId',
    jwtClaim = 'tenantId',
    extractor,
    contextKey = 'tenantId',
    required = true,
    errorMessage = 'Tenant ID is required',
    onMissing,
    validate,
    invalidMessage = 'Invalid tenant ID',
  } = options;

  /**
   * Tenant ID extraction functions by source type.
   * O(1) lookup instead of switch statement.
   */
  const extractors: Record<
    'header' | 'path' | 'query' | 'jwt' | 'custom',
    (ctx: Context<E>) => string | undefined | Promise<string | undefined>
  > = {
    header: (ctx) => ctx.req.header(headerName),
    path: (ctx) => ctx.req.param(pathParam),
    query: (ctx) => ctx.req.query(queryParam),
    jwt: (ctx) => {
      // JWT payload should be set by jwt middleware
      const payload = ctx.get('jwtPayload' as keyof E['Variables']);
      if (payload && typeof payload === 'object') {
        return (payload as Record<string, unknown>)[jwtClaim] as string | undefined;
      }
      return undefined;
    },
    custom: (ctx) => extractor?.(ctx),
  };

  return async (ctx, next) => {
    const extractFn = extractors[source];
    const tenantId = await extractFn(ctx);

    // Handle missing tenant ID
    if (!tenantId) {
      if (required) {
        if (onMissing) {
          return onMissing(ctx);
        }
        throw new HTTPException(400, { message: errorMessage });
      }
      // If not required, continue without tenant ID
      return next();
    }

    // Validate tenant ID if validator provided
    if (validate) {
      const isValid = await validate(tenantId, ctx);
      if (!isValid) {
        throw new HTTPException(400, { message: invalidMessage });
      }
    }

    setContextVar(ctx, contextKey, tenantId);

    return next();
  };
}

/**
 * Type helper for defining tenant-aware Hono app types.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import type { TenantEnv } from 'hono-crud';
 *
 * const app = new Hono<TenantEnv>();
 * app.use('/*', multiTenant());
 *
 * app.get('/data', (c) => {
 *   const tenantId = c.get('tenantId'); // TypeScript knows this is string
 *   return c.json({ tenantId });
 * });
 * ```
 */
export type TenantEnv<TenantKey extends string = 'tenantId'> = {
  Variables: {
    [K in TenantKey]: string;
  };
};

