import type { Context, Env } from 'hono';
import type { ZodObject, ZodRawShape } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getLogger } from './logger';
import type {
  OpenAPIRouteSchema,
  RouteOptions,
  ValidatedData,
} from './types';

/**
 * Base class for OpenAPI routes.
 * Provides request validation, schema generation, and lifecycle hooks.
 */
export abstract class OpenAPIRoute<
  E extends Env = Env,
  Schema extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
> {
  static isRoute = true;

  schema: OpenAPIRouteSchema = {};
  params: RouteOptions = {};

  protected context: Context<E> | null = null;

  /**
   * Main handler method - must be implemented by subclasses.
   */
  abstract handle(): Response | Promise<Response>;

  /**
   * Returns the OpenAPI schema for this route.
   * Override in subclasses to customize.
   */
  getSchema(): OpenAPIRouteSchema {
    return this.schema;
  }

  /**
   * Gets validated request data.
   * Tries zod-openapi's ctx.req.valid() first, falls back to manual parsing.
   */
  async getValidatedData<T = unknown>(): Promise<ValidatedData<T>> {
    if (!this.context) {
      throw new Error('Context not set. Call setContext() first.');
    }

    const ctx = this.context;
    const schema = this.getSchema();
    const data: ValidatedData<T> = {};

    // Get body if schema defines it
    if (schema.request?.body) {
      let body: unknown;
      try {
        // Try zod-openapi validation first
        body = ctx.req.valid('json' as never);
      } catch {
        // zod-openapi not available
      }

      // If zod-openapi didn't provide body, parse manually
      if (body === undefined) {
        try {
          body = await ctx.req.json();
        } catch {
          // No body or invalid JSON
        }
      }

      if (body !== undefined) {
        data.body = body as T;
      }
    }

    // Get query parameters
    if (schema.request?.query) {
      let query: Record<string, unknown> | undefined;
      try {
        // Try zod-openapi validation first
        query = ctx.req.valid('query' as never);
      } catch {
        // zod-openapi not available
      }

      // If zod-openapi didn't provide query, parse manually
      if (query === undefined) {
        query = ctx.req.query();
      }

      if (query !== undefined) {
        data.query = query;
      }
    }

    // Get path parameters
    if (schema.request?.params) {
      let params: Record<string, string> | undefined;
      try {
        // Try zod-openapi validation first
        params = ctx.req.valid('param' as never) as Record<string, string>;
      } catch {
        // zod-openapi not available
      }

      // If zod-openapi didn't provide params, parse manually
      if (params === undefined) {
        params = ctx.req.param() as Record<string, string>;
      }

      if (params !== undefined) {
        data.params = params;
      }
    }

    return data;
  }

  /**
   * Sets the Hono context for this route instance.
   */
  setContext(ctx: Context<E>): void {
    this.context = ctx;
  }

  /**
   * Gets the current Hono context.
   */
  getContext(): Context<E> {
    if (!this.context) {
      throw new Error('Context not set');
    }
    return this.context;
  }

  /**
   * Creates a JSON response using Hono's c.json() helper.
   * Returns Response for compatibility with handle() method signature.
   */
  protected json<T>(data: T, status: ContentfulStatusCode = 200): Response {
    return this.getContext().json(data, status) as unknown as Response;
  }

  /**
   * Creates a success response.
   */
  protected success<T>(result: T, status: ContentfulStatusCode = 200): Response {
    return this.getContext().json({ success: true, result }, status) as unknown as Response;
  }

  /**
   * Runs a promise as a background task after the response is sent.
   * Uses `executionCtx.waitUntil()` when available (Cloudflare Workers, Deno Deploy),
   * otherwise falls back to fire-and-forget with error logging.
   */
  protected runAfterResponse(promise: Promise<unknown>): void {
    let waitUntil: ((p: Promise<unknown>) => void) | undefined;
    try {
      const execCtx = this.getContext().executionCtx;
      if (execCtx && typeof (execCtx as { waitUntil?: unknown }).waitUntil === 'function') {
        waitUntil = (execCtx as { waitUntil: (p: Promise<unknown>) => void }).waitUntil.bind(execCtx);
      }
    } catch {
      // executionCtx getter throws when not in a Workers/edge runtime
    }
    if (waitUntil) {
      waitUntil(promise);
    } else {
      promise.catch(err => {
        getLogger().error('Background task failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  /**
   * Creates an error response.
   */
  protected error(
    message: string,
    code: string = 'ERROR',
    status: ContentfulStatusCode = 400,
    details?: unknown
  ): Response {
    const errorObj: { code: string; message: string; details?: unknown } = { code, message };
    if (details) {
      errorObj.details = details;
    }
    return this.getContext().json(
      {
        success: false,
        error: errorObj,
      },
      status
    ) as unknown as Response;
  }
}

/**
 * Type guard to check if a class is an OpenAPIRoute.
 */
export function isRouteClass(
  cls: unknown
): cls is typeof OpenAPIRoute & { isRoute: true } {
  return (
    typeof cls === 'function' &&
    'isRoute' in cls &&
    (cls as { isRoute: unknown }).isRoute === true
  );
}
