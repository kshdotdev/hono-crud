import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import type { BlankSchema, Schema } from 'hono/types';
import { openApiValidationHook, toOpenApiPath } from '../openapi/utils';
import { ApiException } from './exceptions';
import { resolveInstanceSchemaTags } from './generate-endpoint-class';
import type { OpenAPIRoute } from './route';
import { isRouteClass, jsonResponse } from './route';
import type { RouteClassEntry } from './rpc-types';
import { type OpenAPIRouteSchema, readResponseEnvelope } from './types';

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
  openapi_url?: string;
}

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

// Type for OpenAPIRoute constructor - uses base types since we instantiate dynamically
type OpenAPIRouteConstructor = new () => OpenAPIRoute<Env>;

/**
 * Type for any class that extends OpenAPIRoute.
 * This uses a duck-typed approach to allow subclasses with different generic
 * parameters. `setContext` takes `never` on purpose: it is the one parameter
 * type every `Context<E>` is assignable to, so a route class written against
 * a custom `Env` (bindings + variables) registers on the matching app without
 * the constraint pinning it to the default `Env`.
 */
type OpenAPIRouteClass = new () => {
  getSchema(): OpenAPIRouteSchema;
  handle(): Promise<Response>;
  setContext(ctx: never): void;
};

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
  app: HonoOpenAPIApp<E>,
): HonoOpenAPIHandler<Env> | undefined {
  return HANDLER_REGISTRY.get(app);
}

/**
 * Class-route registration signatures for one HTTP verb. Each call folds the
 * route's schema entry (derived from the class's `schema` property, see
 * `rpc-types.ts`) into the app's accumulated `Schema` generic, so
 * `hc<typeof app>` sees the route exactly like a natively registered one.
 */
type ClassRouteVerb<
  M extends RouteMethod,
  E extends Env,
  S extends Schema,
  BasePath extends string,
> = {
  /** Register a route with an OpenAPIRoute class. */
  <P extends string, C extends OpenAPIRouteClass>(
    path: P,
    RouteClass: C,
  ): HonoOpenAPIApp<E, S & RouteClassEntry<M, P, BasePath, C>, BasePath>;
  /** Register a route with middleware followed by an OpenAPIRoute class. */
  <P extends string, C extends OpenAPIRouteClass>(
    path: P,
    ...handlers: [...MiddlewareHandler<E>[], C]
  ): HonoOpenAPIApp<E, S & RouteClassEntry<M, P, BasePath, C>, BasePath>;
};

/**
 * Type for the proxied Hono app that accepts both regular handlers and OpenAPIRoute classes.
 * This extends OpenAPIHono with overloads for class-based routing.
 *
 * `S` is the accumulated route schema: it grows with every class route and
 * every `registerCrud(...)` call, which is what makes `hc<typeof app>` work.
 * Hono's own verb overloads (plain handlers) are matched first and return
 * Hono's type, so register class routes / CRUD resources before plain
 * handlers when chaining, or keep them in separate statements.
 */
export type HonoOpenAPIApp<
  E extends Env = Env,
  S extends Schema = BlankSchema,
  BasePath extends string = '/',
> = OpenAPIHono<E, S, BasePath> & {
  get: ClassRouteVerb<'get', E, S, BasePath>;
  post: ClassRouteVerb<'post', E, S, BasePath>;
  put: ClassRouteVerb<'put', E, S, BasePath>;
  patch: ClassRouteVerb<'patch', E, S, BasePath>;
  delete: ClassRouteVerb<'delete', E, S, BasePath>;
  options: ClassRouteVerb<'options', E, S, BasePath>;
  head: ClassRouteVerb<'head', E, S, BasePath>;
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
    middlewares: MiddlewareHandler<E>[] = [],
  ): void {
    const routeKey = `${method.toUpperCase()} ${path}`;

    // Create instance to get schema
    const RouteConstructor = RouteClass as unknown as OpenAPIRouteConstructor;
    const instance = new RouteConstructor();
    // Single registration-time choke point for OpenAPI `tags` defaulting: when
    // the endpoint declared no `schema.tags`, inherit the model group
    // (`tag` ?? `tableName`) read structurally from `_meta`. Applies to EVERY
    // endpoint style — factory, sugar, hand-written class — so `Model.tag` is
    // declared once and honored everywhere; an explicit `schema.tags` still
    // wins, and instances with no `_meta` pass through untouched. Doc-only:
    // the validation path (`getValidatedData`) is unaffected.
    const schema = resolveInstanceSchemaTags(instance);

    this.routes.set(routeKey, {
      method,
      path,
      schema,
      routeClass: RouteClass as unknown as OpenAPIRouteClass,
    });

    // Create the zod-openapi route config
    const routeConfig = createRoute({
      method,
      path: toOpenApiPath(path),
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
    // `{id}` form produced by `toOpenApiPath`. Passing the converted form
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
          // Compose the per-route `responseEnvelope` (set by
          // `registerCrud(...)` via the envelope-stash middleware) with
          // the structured `{ code, message, details? }` object built by
          // `ApiException.toJSON()`. This keeps the per-resource shape
          // override observable even when the endpoint short-circuits
          // before reaching `app.onError`.
          const body = error.toJSON();
          const envelope = readResponseEnvelope(c);
          if (envelope) {
            return jsonResponse(c, envelope.error(body.error), error.status);
          }
          return jsonResponse(c, body, error.status);
        }
        throw error;
      }
    });
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
   * Converts Express-style paths (`:id`) to OpenAPI-style paths (`{id}`).
   * Delegates to the canonical `toOpenApiPath` free function in
   * `openapi/utils.ts`; kept as a method so `buildPerTenantOpenApi` can
   * produce identical OpenAPI paths from a handler reference.
   */
  toOpenApiPath(path: string): string {
    return toOpenApiPath(path);
  }
}

/**
 * Creates a proxied Hono app that auto-registers OpenAPIRoute classes.
 *
 * Pass an OpenAPIHono instance to use middleware with your routes.
 * Middleware should be applied directly to the app using `app.use()`.
 *
 * Passing a plain `Hono` is deprecated: it cannot be adopted (class routes
 * need `OpenAPIHono.openapi`), so a fresh `OpenAPIHono` is created in its
 * place. If the plain instance already carries registrations (`.use()`
 * middleware or routes) `fromHono` throws at setup time rather than
 * silently dropping them.
 *
 * Installs the canonical validation hook (`openApiValidationHook`) as the
 * app's `defaultHook` when none is set, so request-schema failures emit the
 * canonical 400 `VALIDATION_ERROR` envelope. To override, pass a
 * pre-configured `new OpenAPIHono({ defaultHook })` — a user-supplied hook
 * always wins. Note: routes registered on a pre-configured `OpenAPIHono`
 * *before* calling `fromHono` keep whatever hook they captured at
 * registration time.
 *
 * @example
 * ```ts
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { fromHono } from 'hono-crud';
 * import { multiTenant } from 'hono-crud/multi-tenant';
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
export function fromHono<E extends Env = Env>(): HonoOpenAPIApp<E, BlankSchema, '/'>;
export function fromHono<E extends Env, S extends Schema, BasePath extends string>(
  router: OpenAPIHono<E, S, BasePath>,
  options?: RouterOptions,
): HonoOpenAPIApp<E, S, BasePath>;
/**
 * @deprecated Pass an `OpenAPIHono` (`new OpenAPIHono<Env>()`). A plain `Hono`
 * cannot be adopted, so a fresh `OpenAPIHono` replaces it; anything already
 * registered on it throws at setup time.
 */
export function fromHono<E extends Env, S extends Schema, BasePath extends string>(
  router: Hono<E, S, BasePath>,
  options?: RouterOptions,
): HonoOpenAPIApp<E, S, BasePath>;
export function fromHono<E extends Env = Env>(
  router: Hono<E, Schema, string> | OpenAPIHono<E, Schema, string> = new OpenAPIHono<E>(),
  options: RouterOptions = {},
): HonoOpenAPIApp<E, Schema, string> {
  // Use the router directly if it's an OpenAPIHono, otherwise create one.
  // A plain `Hono` cannot be adopted (class routes need `OpenAPIHono.openapi`),
  // so anything already registered on it — `.use()` middleware included —
  // would be silently discarded. Fail loudly at setup time instead.
  const isOpenApiHono = 'openAPIRegistry' in router;
  if (!isOpenApiHono && router.routes.length > 0) {
    const lost = router.routes
      .slice(0, 5)
      .map((route) => `${route.method} ${route.path}`)
      .join(', ');
    const more = router.routes.length > 5 ? ', …' : '';
    const count = `${router.routes.length} registration(s)`;
    const advice =
      'Construct the app with `new OpenAPIHono<Env>()` from `@hono/zod-openapi` and register ' +
      'middleware on it (or on the app returned by fromHono) instead.';
    throw new Error(
      `fromHono(): the plain Hono instance already has ${count} (${lost}${more}) that would be discarded. ${advice}`,
    );
  }
  const app = isOpenApiHono ? (router as OpenAPIHono<E>) : new OpenAPIHono<E>();

  // Install the canonical validation hook unless the caller pre-configured
  // one (`new OpenAPIHono({ defaultHook })`) — a user-supplied hook always
  // wins. The cast is required because the hook is typed against `Env`.
  app.defaultHook ??= openApiValidationHook as unknown as OpenAPIHono<E>['defaultHook'];

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

          // Otherwise, use normal Hono routing. Hono returns the app itself for
          // chaining; hand back the proxy so a later `.get(path, RouteClass)` in
          // the same chain still goes through class-route registration.
          const result = (target[prop as keyof typeof target] as (...args: unknown[]) => unknown)(
            path,
            ...handlers,
          );
          return result === target ? proxy : result;
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
  return proxy as HonoOpenAPIApp<E, Schema, string>;
}
