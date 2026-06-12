import type { Context, Env, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { getRequestId } from '../logging/middleware';
import { getWaitUntil } from '../utils/wait-until';
import { ApiException, InputValidationException } from './exceptions';
import { getLogger } from './logger';
import { jsonResponse } from './route';
import { type ResponseEnvelope, type StructuredError, readResponseEnvelope } from './types';

/**
 * Error mapper: transforms unknown errors to ApiException.
 * Return undefined to skip this mapper and try the next one.
 */
export type ErrorMapper<E extends Env = Env> = (
  error: Error,
  ctx: Context<E>,
) => ApiException | undefined | Promise<ApiException | undefined>;

/**
 * Hook: called after mapping, before response (for logging/Sentry).
 * Hooks are fire-and-forget - errors are caught and optionally reported.
 */
export type ErrorHook<E extends Env = Env> = (
  error: Error,
  ctx: Context<E>,
  apiException: ApiException,
) => void | Promise<void>;

/**
 * Configuration options for the error handler factory.
 */
export interface ErrorHandlerConfig<E extends Env = Env> {
  /** Custom error mappers - tried in order, first non-undefined wins */
  mappers?: ErrorMapper<E>[];
  /** Error reporting hooks (logging, Sentry, etc.) */
  hooks?: ErrorHook<E>[];
  /** Include requestId in error response if available (default: true) */
  includeRequestId?: boolean;
  /** Include stack trace in error response (default: false, never enable in production!) */
  includeStackTrace?: boolean;
  /** Default error code for unmapped errors (default: 'INTERNAL_ERROR') */
  defaultErrorCode?: string;
  /** Default error message for unmapped errors (default: 'An internal error occurred') */
  defaultErrorMessage?: string;
  /** Log unmapped errors to console (default: true) */
  logUnmappedErrors?: boolean;
  /** Called when a hook throws an error */
  onHookError?: (hookError: Error, originalError: Error, ctx: Context<E>) => void;
  /**
   * Default response envelope for error responses.
   *
   * When set, every error body is run through `responseEnvelope.error(...)`
   * as the **final formatting step** before serialisation. Composition
   * order is fixed:
   *
   * 1. `ApiException` / `HTTPException` / `mappers[]` produce a structured
   *    error object (`{ code, message, details?, requestId?, stack? }`).
   * 2. The envelope's `error()` wraps that object into the final response
   *    body shape.
   *
   * This decoupling lets consumers keep their domain-error mappers
   * unchanged and layer a custom shape (RFC 7807, JSON:API, …) on top.
   *
   * If a per-route envelope was set via `registerCrud({ responseEnvelope })`,
   * that one wins over the handler-level default — so global JSON:API
   * shape with one resource opting into RFC 7807 is straightforward.
   */
  responseEnvelope?: ResponseEnvelope;
}

/**
 * Built-in mapper for ZodError to InputValidationException.
 */
export const zodErrorMapper: ErrorMapper = (error: Error): ApiException | undefined => {
  if (error instanceof ZodError) {
    return InputValidationException.fromZodError(error);
  }
  return undefined;
};

/**
 * Creates a standardized global error handler for Hono apps.
 *
 * This catches all errors (including non-ApiException errors) and converts
 * them to the standard JSON response format.
 *
 * @example Basic usage:
 * ```typescript
 * const app = fromHono(new Hono());
 * app.onError(createErrorHandler());
 * ```
 *
 * @example With custom mappers and hooks:
 * ```typescript
 * app.onError(createErrorHandler({
 *   mappers: [
 *     (error) => {
 *       if (error.code === 'P2002') {
 *         return new ConflictException('Already exists');
 *       }
 *     },
 *   ],
 *   hooks: [
 *     (error, ctx, apiException) => {
 *       if (apiException.status >= 500) {
 *         Sentry.captureException(error);
 *       }
 *     },
 *   ],
 * }));
 * ```
 */
export function createErrorHandler<E extends Env = Env>(
  config: ErrorHandlerConfig<E> = {},
): ErrorHandler<E> {
  const {
    mappers = [],
    hooks = [],
    includeRequestId = true,
    includeStackTrace = false,
    defaultErrorCode = 'INTERNAL_ERROR',
    defaultErrorMessage = 'An internal error occurred',
    logUnmappedErrors = true,
    onHookError,
    responseEnvelope: defaultEnvelope,
  } = config;

  // Combine custom mappers with built-in mappers
  const allMappers: ErrorMapper<E>[] = [...mappers, zodErrorMapper as unknown as ErrorMapper<E>];

  return async (err: Error, ctx: Context<E>): Promise<Response> => {
    let apiException: ApiException;
    let wasMapped = false;

    // Step 1: Check if error is already ApiException (extends HTTPException)
    if (err instanceof ApiException) {
      apiException = err;
      wasMapped = true;
    }
    // Step 1b: Handle plain HTTPException (from Hono's built-in handlers)
    else if (err instanceof HTTPException) {
      apiException = new ApiException(err.message, err.status, 'HTTP_ERROR');
      wasMapped = true;
    } else {
      // Step 2: Try custom mappers in order
      for (const mapper of allMappers) {
        try {
          const mapped = await mapper(err, ctx);
          if (mapped) {
            apiException = mapped;
            wasMapped = true;
            break;
          }
        } catch {
          // Mapper failed, continue to next
        }
      }

      // Step 3: Fall back to generic 500 error
      if (!wasMapped) {
        if (logUnmappedErrors) {
          getLogger().error('Unmapped error', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        apiException = new ApiException(defaultErrorMessage, 500, defaultErrorCode);
      }
    }

    // Step 4: Run hooks without blocking the response. On Workers async hooks
    // (e.g. error reporting via fetch) must be registered via waitUntil or
    // they are cancelled when the response returns.
    const waitUntil = getWaitUntil(ctx);
    for (const hook of hooks) {
      try {
        const result = hook(err, ctx, apiException!);
        if (result instanceof Promise) {
          const settled = result.catch((hookErr) => {
            if (onHookError) {
              onHookError(hookErr, err, ctx);
            }
          });
          waitUntil?.(settled);
        }
      } catch (hookErr) {
        if (onHookError) {
          onHookError(hookErr as Error, err, ctx);
        }
      }
    }

    // Step 5: Build the structured error object (mapper output).
    const responseBody = apiException!.toJSON();

    // Add requestId if logging middleware is active
    if (includeRequestId) {
      const requestId = getRequestId(ctx);
      if (requestId) {
        responseBody.error.requestId = requestId;
      }
    }

    // Add stack trace if enabled (development only!)
    if (includeStackTrace && err.stack) {
      responseBody.error.stack = err.stack;
    }

    // Step 6: Resolve the response envelope. A per-route envelope set by
    // `registerCrud(...)` (stashed on the request context) takes priority
    // over the handler-level default; this keeps the per-resource
    // override useful even when a single global error handler is wired
    // to the app.
    const envelope = resolveErrorEnvelope(ctx, defaultEnvelope);

    // Step 7: Either pass the structured error through the envelope, or
    // emit the legacy `{ success: false, error: <StructuredError> }`
    // shape verbatim.
    const finalBody = envelope
      ? envelope.error(responseBody.error as StructuredError)
      : responseBody;

    return jsonResponse(ctx, finalBody, apiException!.status);
  };
}

/**
 * Resolve the active `ResponseEnvelope` for an error response. A per-route
 * envelope set via `registerCrud({ responseEnvelope })` wins over the
 * handler-level default, falling back to `undefined` (legacy shape) when
 * neither is configured. Exported for adapter authors who want to bridge
 * a custom global error path through the same composition rule.
 */
export function resolveErrorEnvelope<E extends Env = Env>(
  ctx: Context<E>,
  fallback?: ResponseEnvelope,
): ResponseEnvelope | undefined {
  return readResponseEnvelope(ctx) ?? fallback;
}
