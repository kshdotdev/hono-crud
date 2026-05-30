import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Env, MiddlewareHandler } from 'hono';
import { setContextVar } from '../utils/context';
import { recordCrudResource } from './resource-registry';
import type { OpenAPIRoute } from './route';
import { RESPONSE_ENVELOPE_CONTEXT_KEY, type ResponseEnvelope } from './types';

/**
 * Type for an OpenAPIRoute class constructor.
 * This represents a class that can be instantiated to create a route handler.
 */
export interface EndpointClass<E extends Env = Env> {
  new (): OpenAPIRoute<E>;
  isRoute?: boolean;
  /** Middleware attached via builder or functional API */
  _middlewares?: MiddlewareHandler<E>[];
}

/**
 * All CRUD endpoint names supported by registerCrud.
 */
export type CrudEndpointName =
  | 'create'
  | 'list'
  | 'read'
  | 'update'
  | 'delete'
  | 'restore'
  | 'batchCreate'
  | 'batchUpdate'
  | 'batchDelete'
  | 'batchRestore'
  | 'batchUpsert'
  | 'search'
  | 'aggregate'
  | 'export'
  | 'import'
  | 'upsert'
  | 'clone'
  | 'bulkPatch'
  | 'versionHistory'
  | 'versionRead'
  | 'versionCompare'
  | 'versionRollback';

/**
 * Per-endpoint middleware configuration.
 */
export type EndpointMiddlewares<E extends Env = Env> = Partial<
  Record<CrudEndpointName, MiddlewareHandler<E>[]>
>;

/**
 * Options for registerCrud function.
 */
export interface RegisterCrudOptions<E extends Env = Env> {
  /** Middleware applied to all endpoints */
  middlewares?: MiddlewareHandler<E>[];
  /** Middleware applied to specific endpoints */
  endpointMiddlewares?: EndpointMiddlewares<E>;
  /**
   * Pluggable response envelope for the endpoints registered by this call.
   *
   * When provided, the two functions are the **final formatting step**
   * before the response body is serialised. The default (no override) is
   * byte-identical to pre-0.10.0:
   *
   * - Success: `{ success: true, result, result_info? }`
   * - Error:   `{ success: false, error: { code, message, details? } }`
   *
   * Error composition: any `ErrorMapper`s registered on
   * `createErrorHandler(...)` run **first** and transform the raw `Error`
   * into a structured object; the envelope's `error()` then wraps that
   * object into the final body. This lets consumers keep their existing
   * domain-error mappers (Prisma codes, Drizzle constraint violations,
   * etc.) and layer a custom envelope (RFC 7807, JSON:API, a house
   * standard) on top without writing a response-rewriting middleware.
   *
   * The envelope is propagated to the request via a tiny middleware
   * installed by `registerCrud` and read by `OpenAPIRoute.success` /
   * `OpenAPIRoute.error` / the global error handler. It is therefore
   * scoped to the routes registered by this single `registerCrud(...)`
   * call — different resources can ship different envelopes if needed.
   *
   * @example
   * ```ts
   * registerCrud(app, '/users', endpoints, {
   *   responseEnvelope: {
   *     success: (result, info) => info ? { data: result, meta: info } : { data: result },
   *     error: (err) => ({ error: { code: err.code, message: err.message } }),
   *   },
   * });
   * ```
   */
  responseEnvelope?: ResponseEnvelope;
}

/**
 * CRUD endpoint configuration for registerCrud helper.
 * Accepts any class that extends OpenAPIRoute.
 */
export interface CrudEndpoints<E extends Env = Env> {
  create?: EndpointClass<E>;
  list?: EndpointClass<E>;
  read?: EndpointClass<E>;
  update?: EndpointClass<E>;
  delete?: EndpointClass<E>;
  /** Restore endpoint for un-deleting soft-deleted records */
  restore?: EndpointClass<E>;
  /** Batch create endpoint */
  batchCreate?: EndpointClass<E>;
  /** Batch update endpoint */
  batchUpdate?: EndpointClass<E>;
  /** Batch delete endpoint */
  batchDelete?: EndpointClass<E>;
  /** Batch restore endpoint for un-deleting multiple soft-deleted records */
  batchRestore?: EndpointClass<E>;
  /** Batch upsert endpoint for bulk insert-or-update */
  batchUpsert?: EndpointClass<E>;
  /** Search endpoint for full-text search with relevance scoring */
  search?: EndpointClass<E>;
  /** Aggregate endpoint for computing aggregations */
  aggregate?: EndpointClass<E>;
  /** Export endpoint for bulk data export in CSV/JSON formats */
  export?: EndpointClass<E>;
  /** Import endpoint for bulk data import from CSV/JSON */
  import?: EndpointClass<E>;
  /** Upsert endpoint for single insert-or-update */
  upsert?: EndpointClass<E>;
  /** Clone endpoint for duplicating a record by id */
  clone?: EndpointClass<E>;
  /** Bulk-patch endpoint: PATCH a filtered set of records at the collection level */
  bulkPatch?: EndpointClass<E>;
  /** Version-history list endpoint: `GET /:id/versions` */
  versionHistory?: EndpointClass<E>;
  /** Single-version read endpoint: `GET /:id/versions/:version` */
  versionRead?: EndpointClass<E>;
  /** Version-compare endpoint: `GET /:id/versions/compare` */
  versionCompare?: EndpointClass<E>;
  /** Version-rollback endpoint: `POST /:id/versions/:version/rollback` */
  versionRollback?: EndpointClass<E>;
}

/**
 * Type for the proxied app returned by fromHono.
 * Extends OpenAPIHono to accept both regular handlers and endpoint classes.
 */
export type HonoOpenAPIApp<E extends Env = Env> = OpenAPIHono<E> & {
  /**
   * Register a GET endpoint with an OpenAPIRoute class
   */
  get(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  get(path: string, ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]): HonoOpenAPIApp<E>;
  /**
   * Register a POST endpoint with an OpenAPIRoute class
   */
  post(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  post(path: string, ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]): HonoOpenAPIApp<E>;
  /**
   * Register a PUT endpoint with an OpenAPIRoute class
   */
  put(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  put(path: string, ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]): HonoOpenAPIApp<E>;
  /**
   * Register a PATCH endpoint with an OpenAPIRoute class
   */
  patch(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  patch(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a DELETE endpoint with an OpenAPIRoute class
   */
  delete(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  delete(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]
  ): HonoOpenAPIApp<E>;
};

type RouteRegistrar<E extends Env> = {
  (path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  (path: string, ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]): HonoOpenAPIApp<E>;
};

/**
 * Registers CRUD endpoints for a resource.
 *
 * @example
 * ```ts
 * // Basic usage
 * registerCrud(app, '/users', {
 *   create: UserCreate,
 *   list: UserList,
 *   read: UserRead,
 *   update: UserUpdate,
 *   delete: UserDelete,
 * });
 *
 * // With middleware
 * registerCrud(app, '/users', endpoints, {
 *   middlewares: [authMiddleware],  // All endpoints
 *   endpointMiddlewares: {          // Per-endpoint
 *     create: [adminOnlyMiddleware],
 *     delete: [adminOnlyMiddleware],
 *   },
 * });
 * ```
 */
export function registerCrud<E extends Env = Env>(
  app: HonoOpenAPIApp<E> | OpenAPIHono<E>,
  basePath: string,
  endpoints: CrudEndpoints<E>,
  options: RegisterCrudOptions<E> = {},
): void {
  const normalizedPath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const typedApp = app as HonoOpenAPIApp<E>;
  const { middlewares = [], endpointMiddlewares = {}, responseEnvelope } = options;

  /**
   * Stash the configured `ResponseEnvelope` on the request context so the
   * endpoint base class (`OpenAPIRoute.success` / `error`) and the global
   * error handler (`createErrorHandler`) can read it without coupling to
   * the registration call site. Built once per `registerCrud(...)`; the
   * function-identity is captured by the closure so middleware stays
   * cheap.
   */
  const envelopeMiddleware: MiddlewareHandler<E> | undefined = responseEnvelope
    ? async (c, next) => {
        setContextVar(c, RESPONSE_ENVELOPE_CONTEXT_KEY, responseEnvelope);
        await next();
      }
    : undefined;

  /**
   * Get combined middleware for an endpoint:
   * 1. ResponseEnvelope stash (if configured)
   * 2. Global middleware (from options.middlewares)
   * 3. Per-endpoint middleware (from options.endpointMiddlewares)
   * 4. Class-level middleware (from static _middlewares property)
   */
  const getMiddleware = (name: CrudEndpointName): MiddlewareHandler<E>[] => {
    const endpoint = endpoints[name];
    const classMiddlewares =
      endpoint && '_middlewares' in endpoint
        ? (endpoint as { _middlewares?: MiddlewareHandler<E>[] })._middlewares || []
        : [];

    return [
      ...(envelopeMiddleware ? [envelopeMiddleware] : []),
      ...middlewares,
      ...(endpointMiddlewares[name] || []),
      ...classMiddlewares,
    ];
  };

  // Helper to register route with middleware
  const registerRoute = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    name: CrudEndpointName,
    endpoint: EndpointClass<E>,
  ): void => {
    const mw = getMiddleware(name);
    const register = typedApp[method] as RouteRegistrar<E>;
    if (mw.length > 0) {
      register(path, ...mw, endpoint);
    } else {
      register(path, endpoint);
    }
  };

  // Collection-level routes (no :id parameter)
  if (endpoints.create) {
    registerRoute('post', normalizedPath, 'create', endpoints.create);
  }

  if (endpoints.list) {
    registerRoute('get', normalizedPath, 'list', endpoints.list);
  }

  // IMPORTANT: Batch routes must be registered BEFORE :id routes
  // to prevent /batch from being matched as an id parameter
  if (endpoints.batchCreate) {
    registerRoute('post', `${normalizedPath}/batch`, 'batchCreate', endpoints.batchCreate);
  }

  if (endpoints.batchUpdate) {
    registerRoute('patch', `${normalizedPath}/batch`, 'batchUpdate', endpoints.batchUpdate);
  }

  if (endpoints.batchDelete) {
    registerRoute('delete', `${normalizedPath}/batch`, 'batchDelete', endpoints.batchDelete);
  }

  if (endpoints.batchRestore) {
    registerRoute(
      'post',
      `${normalizedPath}/batch/restore`,
      'batchRestore',
      endpoints.batchRestore,
    );
  }

  if (endpoints.batchUpsert) {
    registerRoute('post', `${normalizedPath}/batch/upsert`, 'batchUpsert', endpoints.batchUpsert);
  }

  // Search endpoint - must be registered BEFORE :id routes
  if (endpoints.search) {
    registerRoute('get', `${normalizedPath}/search`, 'search', endpoints.search);
  }

  // Aggregate endpoint - must be registered BEFORE :id routes
  if (endpoints.aggregate) {
    registerRoute('get', `${normalizedPath}/aggregate`, 'aggregate', endpoints.aggregate);
  }

  // Export endpoint - must be registered BEFORE :id routes
  if (endpoints.export) {
    registerRoute('get', `${normalizedPath}/export`, 'export', endpoints.export);
  }

  // Import endpoint - must be registered BEFORE :id routes
  if (endpoints.import) {
    registerRoute('post', `${normalizedPath}/import`, 'import', endpoints.import);
  }

  // Upsert endpoint - must be registered BEFORE :id routes
  if (endpoints.upsert) {
    registerRoute('post', `${normalizedPath}/upsert`, 'upsert', endpoints.upsert);
  }

  // Bulk-patch endpoint (collection-level) - must be registered BEFORE :id
  // routes so `/bulk` is not matched as an id parameter.
  if (endpoints.bulkPatch) {
    registerRoute('patch', `${normalizedPath}/bulk`, 'bulkPatch', endpoints.bulkPatch);
  }

  // Item-level routes (with :id parameter) - must be registered AFTER /batch, /search, /export, /import, /upsert routes
  if (endpoints.read) {
    registerRoute('get', `${normalizedPath}/:id`, 'read', endpoints.read);
  }

  if (endpoints.update) {
    registerRoute('patch', `${normalizedPath}/:id`, 'update', endpoints.update);
  }

  if (endpoints.delete) {
    registerRoute('delete', `${normalizedPath}/:id`, 'delete', endpoints.delete);
  }

  if (endpoints.restore) {
    registerRoute('post', `${normalizedPath}/:id/restore`, 'restore', endpoints.restore);
  }

  if (endpoints.clone) {
    registerRoute('post', `${normalizedPath}/:id/clone`, 'clone', endpoints.clone);
  }

  // Version sub-resource routes. `/versions/compare` must be registered
  // BEFORE `/versions/:version` so "compare" isn't matched as a version id.
  if (endpoints.versionHistory) {
    registerRoute(
      'get',
      `${normalizedPath}/:id/versions`,
      'versionHistory',
      endpoints.versionHistory,
    );
  }

  if (endpoints.versionCompare) {
    registerRoute(
      'get',
      `${normalizedPath}/:id/versions/compare`,
      'versionCompare',
      endpoints.versionCompare,
    );
  }

  if (endpoints.versionRead) {
    registerRoute(
      'get',
      `${normalizedPath}/:id/versions/:version`,
      'versionRead',
      endpoints.versionRead,
    );
  }

  if (endpoints.versionRollback) {
    registerRoute(
      'post',
      `${normalizedPath}/:id/versions/:version/rollback`,
      'versionRollback',
      endpoints.versionRollback,
    );
  }

  // Record this registration on the app so addons (e.g. @hono-crud/mcp) can
  // enumerate registered resources. App-scoped, startup-time — edge-safe.
  recordCrudResource(app, normalizedPath, endpoints);
}

/**
 * Creates a JSON content type helper for OpenAPI schemas.
 */
export function contentJson<T>(schema: T) {
  return {
    content: {
      'application/json': {
        schema,
      },
    },
  };
}

/**
 * Creates a standardized success response schema.
 */
export function successResponse<T>(schema: T) {
  return {
    description: 'Success',
    ...contentJson({
      type: 'object' as const,
      properties: {
        success: { type: 'boolean' as const, enum: [true] },
        result: schema,
      },
      required: ['success', 'result'],
    }),
  };
}

/**
 * Creates a standardized error response schema.
 */
export function errorResponse(description = 'Error') {
  return {
    description,
    ...contentJson({
      type: 'object' as const,
      properties: {
        success: { type: 'boolean' as const, enum: [false] },
        error: {
          type: 'object' as const,
          properties: {
            code: { type: 'string' as const },
            message: { type: 'string' as const },
            details: {},
          },
          required: ['code', 'message'],
        },
      },
      required: ['success', 'error'],
    }),
  };
}
