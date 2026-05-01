import type { Context, Env } from 'hono';
import type { ZodObject, ZodRawShape } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getLogger } from './logger';
import type {
  OpenAPIRouteSchema,
  RouteOptions,
  ValidatedData,
} from './types';

type ValidationTarget = 'json' | 'query' | 'param';

/**
 * Read a validated value from `ctx.req` if zod-openapi exposed one.
 * Centralized cast — `ctx.req.valid()` requires a literal target type at the
 * call site (overload constraint), but the target is dynamic for our generic
 * `getValidatedData()`.
 */
function readValidated(ctx: Context, target: ValidationTarget): unknown {
  try {
    return (ctx.req as { valid: (t: ValidationTarget) => unknown }).valid(target);
  } catch {
    return undefined;
  }
}

/**
 * Cast through `unknown` to satisfy the `Response` return contract of
 * `handle()`. Hono's `c.json()` returns `TypedResponse<T>` which extends
 * `Response` at runtime but TypeScript sees a generic mismatch. Centralised
 * here so the cast lives in exactly one place.
 */
function asResponse<T>(typed: T): Response {
  return typed as unknown as Response;
}

/**
 * Base class for OpenAPI routes.
 * Provides request validation, schema generation, and lifecycle hooks.
 */
export abstract class OpenAPIRoute<
  E extends Env = Env,
  _Schema extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
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

    // Body
    if (schema.request?.body) {
      let body = readValidated(ctx, 'json');
      if (body === undefined) {
        try {
          body = await ctx.req.json();
        } catch {
          // No body or invalid JSON — expected for non-JSON requests
        }
      }
      if (body !== undefined) {
        data.body = body as T;
      }
    }

    // Query
    if (schema.request?.query) {
      let query = readValidated(ctx, 'query') as Record<string, unknown> | undefined;
      if (query === undefined) {
        query = ctx.req.query();
      }
      if (query !== undefined) {
        data.query = query;
      }
    }

    // Path params
    if (schema.request?.params) {
      let params = readValidated(ctx, 'param') as Record<string, string> | undefined;
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
   */
  protected json<T>(data: T, status: ContentfulStatusCode = 200): Response {
    return asResponse(this.getContext().json(data, status));
  }

  /**
   * Creates a success response.
   */
  protected success<T>(result: T, status: ContentfulStatusCode = 200): Response {
    return asResponse(this.getContext().json({ success: true, result }, status));
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
    return asResponse(this.getContext().json({ success: false, error: errorObj }, status));
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
