import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodObject, ZodRawShape } from 'zod';
import { runAfterResponse as runAfterResponseWithContext } from '../utils/wait-until';
import {
  type OpenAPIRouteSchema,
  type ResponseEnvelope,
  type ResponseEnvelopeInfo,
  type RouteOptions,
  type ValidatedData,
  readResponseEnvelope,
} from './types';

type ValidationTarget = 'json' | 'form' | 'query' | 'param';

/** Media types zod-openapi validates under the `form` target (not `json`). */
function declaresFormBody(body: NonNullable<OpenAPIRouteSchema['request']>['body']): boolean {
  const content = body?.content;
  if (!content) return false;
  return Object.keys(content).some(
    (mediaType) =>
      mediaType.startsWith('multipart/form-data') ||
      mediaType.startsWith('application/x-www-form-urlencoded'),
  );
}

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
 * Emit a JSON response from a generic context.
 *
 * Hono's `c.json` is constrained `<T extends JSONValue>` — a recursive
 * union that pegs TypeScript's inference budget when threaded through
 * `OpenAPIRoute<T>`'s base-class generic. The `ResponseEnvelope`
 * contract (`types.ts`) intentionally returns `unknown` so consumers
 * can produce any JSON-serialisable shape; that doesn't structurally
 * satisfy `JSONValue`, and constraining the library's `T` to
 * `JSONValue` everywhere would force every entity row through a
 * recursive type check.
 *
 * The honest fix is a single **function-signature cast**: we widen
 * `c.json`'s shape to `(unknown, ContentfulStatusCode) => Response`
 * here, once. This subsumes both the legacy input cast
 * (`body as Record<string, unknown>`) and the legacy output cast
 * (the old `asResponse` helper). Every call site is now cast-free.
 */
export function jsonResponse<E extends Env>(
  ctx: Context<E>,
  body: unknown,
  status: ContentfulStatusCode,
): Response {
  type WideJson = (b: unknown, s: ContentfulStatusCode) => Response;
  return (ctx.json as unknown as WideJson)(body, status);
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

    // Body. zod-openapi validates JSON bodies under the `json` target and
    // multipart / URL-encoded bodies under `form`; read whichever ran, then
    // fall back to parsing the raw request the same way.
    if (schema.request?.body) {
      let body = readValidated(ctx, 'json') ?? readValidated(ctx, 'form');
      if (body === undefined) {
        try {
          body = declaresFormBody(schema.request.body)
            ? await ctx.req.parseBody()
            : await ctx.req.json();
        } catch {
          // No body, or a body that does not match the declared media type
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
    return jsonResponse(this.getContext(), data, status);
  }

  /**
   * Resolve the active `ResponseEnvelope` (if any) from the request
   * context. `registerCrud(...)` installs a thin middleware that stashes
   * the envelope here; endpoints attached outside `registerCrud` simply
   * see `undefined` and fall through to the default shape.
   */
  protected getResponseEnvelope(): ResponseEnvelope | undefined {
    return readResponseEnvelope(this.context);
  }

  /**
   * Creates a success response.
   *
   * When a `ResponseEnvelope` is configured (via `registerCrud`'s
   * `responseEnvelope` option), the result is passed through
   * `envelope.success(result)` as the **final formatting step** before
   * serialisation. Default shape is `{ success: true, result }`.
   */
  protected success<T>(result: T, status: ContentfulStatusCode = 200): Response {
    const envelope = this.getResponseEnvelope();
    const body = envelope ? envelope.success(result) : { success: true, result };
    return jsonResponse(this.getContext(), body, status);
  }

  /**
   * Creates a success response for paginated/list endpoints.
   *
   * Identical to `success()` except that the pagination metadata is
   * threaded into `envelope.success(result, info)` as the second arg, or
   * emitted as `{ success: true, result, result_info }` in the default
   * shape.
   */
  protected successPaginated<T>(
    result: T,
    info: ResponseEnvelopeInfo,
    status: ContentfulStatusCode = 200,
  ): Response {
    const envelope = this.getResponseEnvelope();
    const body = envelope
      ? envelope.success(result, info)
      : { success: true, result, result_info: info };
    return jsonResponse(this.getContext(), body, status);
  }

  /**
   * Runs a promise as a background task after the response is sent.
   * Uses `executionCtx.waitUntil()` when available (Cloudflare Workers, Deno Deploy),
   * otherwise falls back to fire-and-forget with error logging.
   */
  protected runAfterResponse(promise: Promise<unknown>): void {
    runAfterResponseWithContext(this.getContext(), promise);
  }

  /**
   * Creates an error response.
   *
   * When a `ResponseEnvelope` is configured (via `registerCrud`'s
   * `responseEnvelope` option), the structured error object is passed
   * through `envelope.error(...)` as the final formatting step. Default
   * shape is `{ success: false, error: { code, message, details? } }`.
   *
   * Note: this helper is for endpoint-side short-circuit errors. Errors
   * thrown out of `handle()` flow through Hono's `app.onError(...)` and
   * are formatted by `createErrorHandler`, which composes the same
   * envelope with any registered `ErrorMapper`s.
   */
  protected error(
    message: string,
    code = 'ERROR',
    status: ContentfulStatusCode = 400,
    details?: unknown,
  ): Response {
    const errorObj: { code: string; message: string; details?: unknown } = { code, message };
    if (details !== undefined) {
      errorObj.details = details;
    }
    const envelope = this.getResponseEnvelope();
    const body = envelope ? envelope.error(errorObj) : { success: false, error: errorObj };
    return jsonResponse(this.getContext(), body, status);
  }
}

/**
 * Identity helper that keeps a route schema's literal shape (status-code
 * keys, zod schema identities) so the typed RPC client can read request and
 * response types back out of it. Equivalent to writing
 * `schema = { … } satisfies OpenAPIRouteSchema` on the class; useful where a
 * schema object is built outside the class body.
 *
 * Do not add `as const`: it would make `tags` a readonly tuple, which the
 * `tags?: string[]` field of `OpenAPIRouteSchema` rejects.
 */
export function defineRouteSchema<S extends OpenAPIRouteSchema>(schema: S): S {
  return schema;
}

/**
 * Type guard to check if a class is an OpenAPIRoute.
 */
export function isRouteClass(cls: unknown): cls is typeof OpenAPIRoute & { isRoute: true } {
  return (
    typeof cls === 'function' && 'isRoute' in cls && (cls as { isRoute: unknown }).isRoute === true
  );
}
