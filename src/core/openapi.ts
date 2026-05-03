import type { Hono, Env, Context, MiddlewareHandler } from 'hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { OpenAPIRoute } from './route';
import { isRouteClass } from './route';
import { ApiException } from './exceptions';
import type { OpenAPIRouteSchema } from './types';

export interface OpenAPIConfig {
  openapi?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
}

export interface RouterOptions {
  base?: string;
  docs_url?: string;
  redoc_url?: string;
  openapi_url?: string;
}

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

// Type for OpenAPIRoute constructor - uses base types since we instantiate dynamically
type OpenAPIRouteConstructor = new () => OpenAPIRoute<Env>;

/**
 * Type for any class that extends OpenAPIRoute.
 * This uses a duck-typed approach to allow subclasses with different generic parameters.
 */
type OpenAPIRouteClass = new () => { getSchema(): OpenAPIRouteSchema; handle(): Promise<Response>; setContext(ctx: Context<Env>): void };

/**
 * Per-route registration data. The `routeClass` reference is what
 * `buildPerTenantOpenApi(...)` needs to re-instantiate the route under a
 * synthetic tenant context and re-emit per-tenant OpenAPI.
 */
export interface RegisteredRoute {
  method: RouteMethod;
  path: string;
  schema: OpenAPIRouteSchema;
  routeClass: OpenAPIRouteClass;
}

/**
 * Maps a proxied `HonoOpenAPIApp` back to the `HonoOpenAPIHandler` that
 * powers it, so `buildPerTenantOpenApi(app, ctx)` can locate the handler
 * (and its registered routes) without requiring callers to thread the
 * handler reference through their app construction.
 *
 * Keyed by `WeakKey` (any object) because `HonoOpenAPIApp<E>` varies in
 * `E` and TS rejects covariant narrowing of the proxy reference; the map
 * itself is opaque storage so the lack of generic propagation is fine.
 */
const HANDLER_REGISTRY: WeakMap<WeakKey, HonoOpenAPIHandler<Env>> = new WeakMap();

/**
 * Look up the `HonoOpenAPIHandler` associated with a proxied app. Internal
 * helper for `buildPerTenantOpenApi`. Returns `undefined` for any app not
 * created via `fromHono(...)`.
 */
export function getHandlerForApp<E extends Env = Env>(
  app: HonoOpenAPIApp<E>
): HonoOpenAPIHandler<Env> | undefined {
  return HANDLER_REGISTRY.get(app);
}

/**
 * Type for the proxied Hono app that accepts both regular handlers and OpenAPIRoute classes.
 * This extends OpenAPIHono with method overloads for class-based routing.
 */
export type HonoOpenAPIApp<E extends Env = Env> = OpenAPIHono<E> & {
  /**
   * Register a GET route with an OpenAPIRoute class.
   */
  get(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  get(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a POST route with an OpenAPIRoute class.
   */
  post(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  post(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a PUT route with an OpenAPIRoute class.
   */
  put(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  put(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a PATCH route with an OpenAPIRoute class.
   */
  patch(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  patch(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a DELETE route with an OpenAPIRoute class.
   */
  delete(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  delete(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register an OPTIONS route with an OpenAPIRoute class.
   */
  options(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  options(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a HEAD route with an OpenAPIRoute class.
   */
  head(path: string, RouteClass: OpenAPIRouteClass): HonoOpenAPIApp<E>;
  head(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], OpenAPIRouteClass]
  ): HonoOpenAPIApp<E>;
  /**
   * Set up OpenAPI documentation endpoint.
   */
  doc(path: string, config: OpenAPIConfig): void;
};

/**
 * Handler for OpenAPI routes with Hono.
 */
export class HonoOpenAPIHandler<E extends Env = Env> {
  private app: OpenAPIHono<E>;
  private options: RouterOptions;
  protected routes: Map<string, RegisteredRoute> = new Map();

  constructor(app: OpenAPIHono<E>, options: RouterOptions = {}) {
    this.app = app;
    this.options = {
      docs_url: '/docs',
      redoc_url: '/redoc',
      openapi_url: '/openapi.json',
      ...options,
    };
  }

  /**
   * Registers an OpenAPIRoute class as a route.
   */
  registerRoute(
    method: RouteMethod,
    path: string,
    RouteClass: typeof OpenAPIRoute,
    middlewares: MiddlewareHandler<E>[] = []
  ): void {
    const routeKey = `${method.toUpperCase()} ${path}`;

    // Create instance to get schema
    const RouteConstructor = RouteClass as unknown as OpenAPIRouteConstructor;
    const instance = new RouteConstructor();
    const schema = instance.getSchema();

    this.routes.set(routeKey, {
      method,
      path,
      schema,
      routeClass: RouteClass as unknown as OpenAPIRouteClass,
    });

    // Create the zod-openapi route config
    const routeConfig = createRoute({
      method,
      path: this.convertPath(path),
      ...schema,
      responses: schema.responses || {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    });

    // Apply middleware for this specific path+method before route handler.
    // NOTE: `app.use(...)` uses Hono's `:id` route-syntax, NOT the OpenAPI
    // `{id}` form produced by `convertPath`. Passing the converted form
    // here results in middleware that never matches dynamic-segment routes
    // (e.g. `/widgets/:id`) — the literal `{id}` segment never appears in
    // an actual request. Use the raw path so `:id` matches at runtime.
    if (middlewares.length > 0) {
      for (const mw of middlewares) {
        this.app.use(path, async (c, next) => {
          // Only apply middleware if the HTTP method matches
          if (c.req.method.toLowerCase() === method) {
            return mw(c as Context<E>, next);
          }
          await next();
        });
      }
    }

    // Register with OpenAPIHono
    this.app.openapi(routeConfig, async (c) => {
      const routeInstance = new RouteConstructor();
      // Cast through unknown required: route instances are dynamically created
      // and their Env type may differ from the handler's generic E parameter
      routeInstance.setContext(c as unknown as Context<Env>);

      try {
        const response = await routeInstance.handle();
        return response;
      } catch (error) {
        if (error instanceof ApiException) {
          return c.json(error.toJSON(), error.status as 200);
        }
        throw error;
      }
    });
  }

  /**
   * Converts Express-style paths (:id) to OpenAPI-style paths ({id}).
   */
  private convertPath(path: string): string {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
  }

  /**
   * Sets up the OpenAPI documentation endpoints.
   * Falls back to `options.openapi_url` when no path is provided.
   * @param path - The path to serve the OpenAPI JSON at
   * @param config - OpenAPI configuration
   */
  setupDocs(path: string | undefined, config: OpenAPIConfig): void {
    const docPath = path ?? this.options.openapi_url ?? '/openapi.json';
    // OpenAPI JSON endpoint
    this.app.doc(docPath, {
      openapi: config.openapi || '3.1.0',
      info: config.info,
      servers: config.servers,
      security: config.security,
    });
  }

  getApp(): OpenAPIHono<E> {
    return this.app;
  }

  /**
   * Returns the routes registered with this handler. `buildPerTenantOpenApi`
   * uses this to walk every route and re-emit the OpenAPI document under a
   * specific tenant context.
   */
  getRegisteredRoutes(): ReadonlyMap<string, RegisteredRoute> {
    return this.routes;
  }

  /**
   * Internal helper used by `convertPath`. Exposed as protected so
   * `buildPerTenantOpenApi` can produce identical OpenAPI paths.
   */
  toOpenApiPath(path: string): string {
    return this.convertPath(path);
  }
}

/**
 * Creates a proxied Hono app that auto-registers OpenAPIRoute classes.
 *
 * Pass an OpenAPIHono instance to use middleware with your routes.
 * Middleware should be applied directly to the app using `app.use()`.
 *
 * @example
 * ```ts
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { fromHono, multiTenant } from 'hono-crud';
 *
 * const app = fromHono(new OpenAPIHono());
 *
 * // Apply middleware directly to the app
 * app.use('/*', multiTenant());
 *
 * // Register routes
 * app.post('/users', UserCreate);
 * app.get('/users', UserList);
 * ```
 */
export function fromHono<E extends Env = Env>(
  router: Hono<E> | OpenAPIHono<E> = new OpenAPIHono<E>(),
  options: RouterOptions = {}
): HonoOpenAPIApp<E> {
  // Use the router directly if it's an OpenAPIHono, otherwise create one
  const app = 'openAPIRegistry' in router
    ? (router as OpenAPIHono<E>)
    : new OpenAPIHono<E>();

  const handler = new HonoOpenAPIHandler<E>(app, options);
  const methods: RouteMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  // Create proxy to intercept route registrations
  const proxy = new Proxy(app, {
    get(target, prop: string) {
      if (methods.includes(prop as RouteMethod)) {
        return (path: string, ...handlers: unknown[]) => {
          // Find the last argument - could be a route class
          const lastArg = handlers[handlers.length - 1];

          // Check if the last argument is an OpenAPIRoute class
          if (isRouteClass(lastArg)) {
            // All arguments before the route class are middleware
            const middlewares = handlers.slice(0, -1) as MiddlewareHandler<E>[];
            handler.registerRoute(prop as RouteMethod, path, lastArg, middlewares);
            return proxy;
          }

          // Otherwise, use normal Hono routing
          return (target[prop as keyof typeof target] as (...args: unknown[]) => unknown)(
            path,
            ...handlers
          );
        };
      }

      if (prop === 'doc') {
        return (path: string, config: OpenAPIConfig) => {
          handler.setupDocs(path, config);
        };
      }

      // For 'use' method, apply to the app and return proxy for chaining
      if (prop === 'use') {
        return (...args: unknown[]) => {
          (target[prop as keyof typeof target] as (...args: unknown[]) => unknown)(...args);
          return proxy;
        };
      }

      const value = target[prop as keyof typeof target];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });

  HANDLER_REGISTRY.set(proxy, handler as unknown as HonoOpenAPIHandler<Env>);
  return proxy as HonoOpenAPIApp<E>;
}
