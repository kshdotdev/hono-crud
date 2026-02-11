import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Env, MiddlewareHandler } from 'hono';
import type { OpenAPIRoute } from './core/route';

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
  | 'search'
  | 'aggregate'
  | 'export'
  | 'import'
  | 'nlQuery'
  | 'rag';

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
  /** Search endpoint for full-text search with relevance scoring */
  search?: EndpointClass<E>;
  /** Aggregate endpoint for computing aggregations */
  aggregate?: EndpointClass<E>;
  /** Export endpoint for bulk data export in CSV/JSON formats */
  export?: EndpointClass<E>;
  /** Import endpoint for bulk data import from CSV/JSON */
  import?: EndpointClass<E>;
  /** Natural language query endpoint (requires AI model) */
  nlQuery?: EndpointClass<E>;
  /** RAG (Retrieval-Augmented Generation) endpoint (requires AI model) */
  rag?: EndpointClass<E>;
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
  get(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a POST endpoint with an OpenAPIRoute class
   */
  post(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  post(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]
  ): HonoOpenAPIApp<E>;
  /**
   * Register a PUT endpoint with an OpenAPIRoute class
   */
  put(path: string, handler: EndpointClass<E>): HonoOpenAPIApp<E>;
  put(
    path: string,
    ...handlers: [...MiddlewareHandler<E>[], EndpointClass<E>]
  ): HonoOpenAPIApp<E>;
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
  options: RegisterCrudOptions<E> = {}
): void {
  const normalizedPath = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath;
  const typedApp = app as HonoOpenAPIApp<E>;
  const { middlewares = [], endpointMiddlewares = {} } = options;

  /**
   * Get combined middleware for an endpoint:
   * 1. Global middleware (from options.middlewares)
   * 2. Per-endpoint middleware (from options.endpointMiddlewares)
   * 3. Class-level middleware (from static _middlewares property)
   */
  const getMiddleware = (name: CrudEndpointName): MiddlewareHandler<E>[] => {
    const endpoint = endpoints[name];
    const classMiddlewares =
      endpoint && '_middlewares' in endpoint
        ? (endpoint as { _middlewares?: MiddlewareHandler<E>[] })._middlewares ||
          []
        : [];

    return [...middlewares, ...(endpointMiddlewares[name] || []), ...classMiddlewares];
  };

  // Helper to register route with middleware
  const registerRoute = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    name: CrudEndpointName,
    endpoint: EndpointClass<E>
  ): void => {
    const mw = getMiddleware(name);
    if (mw.length > 0) {
      (typedApp[method] as Function)(path, ...mw, endpoint);
    } else {
      (typedApp[method] as Function)(path, endpoint);
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
    registerRoute('post', `${normalizedPath}/batch/restore`, 'batchRestore', endpoints.batchRestore);
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

  // AI endpoints - must be registered BEFORE :id routes
  if (endpoints.nlQuery) {
    registerRoute('post', `${normalizedPath}/nl-query`, 'nlQuery', endpoints.nlQuery);
  }

  if (endpoints.rag) {
    registerRoute('post', `${normalizedPath}/ask`, 'rag', endpoints.rag);
  }

  // Item-level routes (with :id parameter) - must be registered AFTER /batch, /search, /export, /import routes
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
export function errorResponse(description: string = 'Error') {
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
