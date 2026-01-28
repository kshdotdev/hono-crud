import type { Context, Env, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { ApiException, InputValidationException } from './exceptions.js';
import { getRequestId } from '../logging/middleware.js';

/**
 * Error mapper: transforms unknown errors to ApiException.
 * Return undefined to skip this mapper and try the next one.
 */
export type ErrorMapper<E extends Env = Env> = (
  error: Error,
  ctx: Context<E>
) => ApiException | undefined | Promise<ApiException | undefined>;

/**
 * Hook: called after mapping, before response (for logging/Sentry).
 * Hooks are fire-and-forget - errors are caught and optionally reported.
 */
export type ErrorHook<E extends Env = Env> = (
  error: Error,
  ctx: Context<E>,
  apiException: ApiException
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
  config: ErrorHandlerConfig<E> = {}
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
      apiException = new ApiException(
        err.message,
        err.status,
        'HTTP_ERROR'
      );
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
          console.error('[ErrorHandler] Unmapped error:', err);
        }
        apiException = new ApiException(
          defaultErrorMessage,
          500,
          defaultErrorCode
        );
      }
    }

    // Step 4: Run hooks (fire-and-forget)
    for (const hook of hooks) {
      try {
        const result = hook(err, ctx, apiException!);
        if (result instanceof Promise) {
          result.catch((hookErr) => {
            if (onHookError) {
              onHookError(hookErr, err, ctx);
            }
          });
        }
      } catch (hookErr) {
        if (onHookError) {
          onHookError(hookErr as Error, err, ctx);
        }
      }
    }

    // Step 5: Build response
    const responseBody = apiException!.toJSON();

    // Add requestId if logging middleware is active
    if (includeRequestId) {
      const requestId = getRequestId(ctx);
      if (requestId) {
        (responseBody.error as Record<string, unknown>).requestId = requestId;
      }
    }

    // Add stack trace if enabled (development only!)
    if (includeStackTrace && err.stack) {
      (responseBody.error as Record<string, unknown>).stack = err.stack;
    }

    // Step 6: Return JSON response
    return ctx.json(responseBody, apiException!.status as 200);
  };
}
