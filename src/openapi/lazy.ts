/**
 * Per-tenant OpenAPI emission.
 *
 * `buildPerTenantOpenApi(app, ctx, options?)` walks every route registered
 * via `fromHono(...)`, awaits each model's `Model.resolveSchema(ctx)` (so
 * routes that use the resolver hook emit per-tenant request/response
 * shapes), and returns a fresh OpenAPI document. The static `app.doc(...)`
 * registration is unaffected — this is for consumers that need to serve a
 * different document per tenant (e.g. tenant-scoped custom fields).
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z, type ZodObject, type ZodRawShape } from 'zod';

import type { HonoOpenAPIApp } from '../core/openapi';
import { getHandlerForApp } from '../core/openapi';
import type { SchemaResolveContext } from '../core/types';

/**
 * Loose, structurally-typed cache adapter. Any object with `get(key)` and
 * `set(key, value, ttlMs?)` works — including a thin wrapper around the
 * lib's existing `CacheStorage` (use `wrapCacheStorageForOpenApi` below).
 */
export interface PerTenantOpenApiCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): void | Promise<void>;
}

/**
 * Minimum config needed to render an OpenAPI document. If omitted,
 * `buildPerTenantOpenApi` falls back to a generic `{ title: 'API',
 * version: '1.0.0' }`.
 */
export interface PerTenantOpenApiConfig {
  openapi?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
}

export interface PerTenantOpenApiOptions {
  /** Pluggable cache. Cache key is `openapi:{tenantId|'global'}:{info.version}`. */
  cache?: PerTenantOpenApiCache;
  /** TTL in milliseconds for cached entries. @default 60_000 */
  cacheTtlMs?: number;
  /** OpenAPI document metadata. Defaults to a generic placeholder. */
  config?: PerTenantOpenApiConfig;
  /** Choose 3.0 or 3.1 emission. @default '3.1' */
  spec?: '3.0' | '3.1';
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_CONFIG: PerTenantOpenApiConfig = {
  openapi: '3.1.0',
  info: { title: 'API', version: '1.0.0' },
};

/**
 * Build an OpenAPI document for a specific tenant context.
 *
 * For every route registered via `fromHono(...)`:
 *   1. Instantiate a fresh route under a synthetic Hono context that
 *      carries `ctx.tenantId` / `ctx.organizationId`.
 *   2. Await `resolveModelSchema()` so the route's `getSchema()` reads
 *      the per-tenant Zod model schema instead of the static one.
 *   3. Re-register the route with `OpenAPIHono` to pick up the resolved
 *      schemas, then call `getOpenAPI31Document(...)` (or 3.0).
 *
 * Errors in any model's resolver propagate as a structured 500 — same
 * `ApiException` envelope as the request-time path.
 */
export async function buildPerTenantOpenApi(
  app: HonoOpenAPIApp,
  ctx: SchemaResolveContext,
  options: PerTenantOpenApiOptions = {}
): Promise<unknown> {
  const handler = getHandlerForApp(app);
  if (!handler) {
    throw new Error(
      'buildPerTenantOpenApi: app was not produced by fromHono(...). Cannot find route registry.'
    );
  }

  const config = options.config ?? DEFAULT_CONFIG;
  const cacheKey =
    `openapi:${ctx.tenantId ?? 'global'}:${config.info.version}`;

  if (options.cache) {
    const cached = await options.cache.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;
  }

  const tenantApp = new OpenAPIHono();

  for (const route of handler.getRegisteredRoutes().values()) {
    const Ctor = route.routeClass;
    // The `OpenAPIRouteClass` constructor type already provides
    // `setContext`/`getSchema`/`handle`. CrudEndpoint subclasses also
    // expose `resolveModelSchema` (optional here so non-CRUD routes
    // still match). The intersection avoids the previous duck-typed cast.
    type RuntimeRoute = InstanceType<typeof Ctor> & {
      resolveModelSchema?: () => Promise<ZodObject<ZodRawShape>>;
    };
    const instance: RuntimeRoute = new Ctor();
    const synthCtx = makeSyntheticContext(ctx);
    instance.setContext(synthCtx as unknown as Context);
    if (typeof instance.resolveModelSchema === 'function') {
      await instance.resolveModelSchema();
    }
    // Cast to widen `OpenAPIRouteSchema` (the lib's wrapper) into the
    // `RouteConfig` shape `createRoute` expects. `OpenAPIRouteSchema` is
    // a structural subset (no required `method`/`path`) — we add those
    // below — but TS can't unify the responses union without the cast.
    const schema = instance.getSchema() as Parameters<typeof createRoute>[0];

    const routeConfig = createRoute({
      ...schema,
      method: route.method,
      path: handler.toOpenApiPath(route.path),
      responses: schema.responses ?? {
        200: {
          description: 'Success',
          content: {
            // `z.unknown()` is the placeholder that satisfies the
            // edge-safety static scan (`z.any()` is banned in
            // `tests/edge-safety.test.ts`). Both serialize to the same
            // unconstrained OpenAPI schema for documentation purposes.
            'application/json': { schema: z.unknown() },
          },
        },
      },
    });

    // Dummy handler — we only want the schema in the registry, never invoke.
    tenantApp.openapi(routeConfig, () => new Response());
  }

  const docConfig = {
    openapi: config.openapi ?? '3.1.0',
    info: config.info,
    servers: config.servers,
    security: config.security,
  };
  const doc =
    options.spec === '3.0'
      ? tenantApp.getOpenAPIDocument(docConfig)
      : tenantApp.getOpenAPI31Document(docConfig);

  if (options.cache) {
    await options.cache.set(cacheKey, doc, options.cacheTtlMs ?? DEFAULT_TTL_MS);
  }

  return doc;
}

/**
 * Build a synthetic Hono context shaped just enough that the lib's
 * per-request helpers (`getContextVar`, `setContextVar`, `extractTenantId`,
 * `getTenantId`) work. This context is used only during OpenAPI emission;
 * never reaches user code.
 */
function makeSyntheticContext(ctx: SchemaResolveContext): {
  var: Record<string, unknown>;
  env: unknown;
  req: {
    raw: Request;
    header: () => undefined;
    query: () => undefined;
    param: () => undefined;
  };
  set: (key: string, value: unknown) => void;
  get: (key: string) => unknown;
  executionCtx: undefined;
} {
  const vars: Record<string, unknown> = {};
  if (ctx.tenantId !== undefined) vars.tenantId = ctx.tenantId;
  if (ctx.organizationId !== undefined) vars.organizationId = ctx.organizationId;
  const raw = ctx.request ?? new Request('http://localhost/');
  return {
    var: vars,
    env: ctx.env,
    req: {
      raw,
      header: () => undefined,
      query: () => undefined,
      param: () => undefined,
    },
    set(key, value) {
      vars[key] = value;
    },
    get(key) {
      return vars[key];
    },
    executionCtx: undefined,
  };
}

/**
 * Adapt the lib's `CacheStorage` (which wraps values in `{ data, createdAt,
 * expiresAt }`) to the loose `PerTenantOpenApiCache` shape. Useful when
 * you want to reuse `c.var.cacheStorage` from the storage middleware.
 *
 * @example
 * ```ts
 * import { buildPerTenantOpenApi, wrapCacheStorageForOpenApi } from 'hono-crud';
 *
 * app.get('/openapi/:tenantId', async (c) => {
 *   const doc = await buildPerTenantOpenApi(app, { tenantId: c.req.param('tenantId') }, {
 *     cache: wrapCacheStorageForOpenApi(c.var.cacheStorage),
 *   });
 *   return c.json(doc);
 * });
 * ```
 */
export function wrapCacheStorageForOpenApi(storage: {
  get<T>(key: string): Promise<{ data: T } | null>;
  set<T>(key: string, data: T, options?: { ttl?: number }): Promise<void>;
}): PerTenantOpenApiCache {
  return {
    async get(key) {
      const entry = await storage.get<unknown>(key);
      return entry ? entry.data : undefined;
    },
    async set(key, value, ttlMs) {
      const ttlSeconds = ttlMs ? Math.ceil(ttlMs / 1000) : undefined;
      await storage.set(key, value, ttlSeconds ? { ttl: ttlSeconds } : undefined);
    },
  };
}
