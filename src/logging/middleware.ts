import type { Context, Env, MiddlewareHandler } from 'hono';
import { getLogger } from '../core/logger';
import type {
  LoggingConfig,
  LoggingStorage,
  LogEntry,
  LogLevel,
  RedactField,
  PathPattern,
} from './types';
import {
  shouldExcludePath,
  extractClientIp,
  extractHeaders,
  extractQuery,
  extractUserId,
  redactHeaders,
  redactObject,
  truncateBody,
  isAllowedContentType,
  generateRequestId as defaultGenerateRequestId,
} from './utils';
import { resolveLoggingStorage } from '../storage/helpers';
import { toError } from '../utils/errors';
import { getContextVar, setContextVar } from '../core/context-helpers';
import { createNullableRegistry } from '../storage/registry';

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Global logging storage registry.
 * Nullable -- no default storage is created unless explicitly set.
 */
export const loggingStorageRegistry = createNullableRegistry<LoggingStorage>(
  'loggingStorage'
);

/**
 * Set the global logging storage.
 * Used when storage is not provided in middleware config.
 *
 * @example
 * ```ts
 * import { setLoggingStorage, MemoryLoggingStorage } from 'hono-crud';
 *
 * setLoggingStorage(new MemoryLoggingStorage());
 * ```
 */
export function setLoggingStorage(storage: LoggingStorage): void {
  loggingStorageRegistry.set(storage);
}

/**
 * Get the global logging storage.
 * @returns The global storage or null if not set
 */
export function getLoggingStorage(): LoggingStorage | null {
  return loggingStorageRegistry.get();
}

// ============================================================================
// Default Configuration
// ============================================================================

/** Default headers to redact */
const DEFAULT_REDACT_HEADERS: RedactField[] = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

/** Default body fields to redact */
const DEFAULT_REDACT_BODY_FIELDS: RedactField[] = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'creditCard',
  'credit_card',
  'ssn',
  'socialSecurityNumber',
];

/** Default paths to exclude from logging */
const DEFAULT_EXCLUDE_PATHS: PathPattern[] = [
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/live',
  '/livez',
  '/metrics',
  '/favicon.ico',
];

// ============================================================================
// Context Helpers
// ============================================================================

/**
 * Get the request ID from context.
 * Only available if logging middleware is applied.
 *
 * @param ctx - Hono context
 * @returns The request ID or undefined
 */
export function getRequestId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'requestId');
}

/**
 * Get the request start time from context.
 * Only available if logging middleware is applied.
 *
 * @param ctx - Hono context
 * @returns The start time in milliseconds or undefined
 */
export function getRequestStartTime<E extends Env>(ctx: Context<E>): number | undefined {
  return getContextVar<number>(ctx, 'requestStartTime');
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates logging middleware for request/response tracking.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import {
 *   createLoggingMiddleware,
 *   setLoggingStorage,
 *   MemoryLoggingStorage,
 * } from 'hono-crud';
 *
 * // Setup storage (do this once at startup)
 * setLoggingStorage(new MemoryLoggingStorage());
 *
 * const app = new Hono();
 *
 * // Add logging middleware
 * app.use('*', createLoggingMiddleware({
 *   excludePaths: ['/health', '/docs/*'],
 *   requestBody: { enabled: true, maxSize: 10240 },
 *   responseBody: { enabled: true, maxSize: 10240 },
 * }));
 * ```
 *
 * @example
 * ```ts
 * // Custom level resolver
 * app.use('*', createLoggingMiddleware({
 *   levelResolver: (ctx, responseTimeMs, statusCode, error) => {
 *     if (error || statusCode >= 500) return 'error';
 *     if (statusCode >= 400) return 'warn';
 *     if (responseTimeMs > 1000) return 'warn';
 *     return 'info';
 *   },
 * }));
 * ```
 *
 * @example
 * ```ts
 * // With console handler
 * app.use('*', createLoggingMiddleware({
 *   handlers: [(entry) => {
 *     console.log(`[${entry.level.toUpperCase()}] ${entry.request.method} ${entry.request.path} - ${entry.response.statusCode} (${entry.response.responseTimeMs}ms)`);
 *   }],
 * }));
 * ```
 */
export function createLoggingMiddleware<E extends Env = Env>(
  config: LoggingConfig<E> = {}
): MiddlewareHandler<E> {
  // Default configuration
  const enabled = config.enabled ?? true;
  const defaultLevel = config.level ?? 'info';
  const includePaths = config.includePaths ?? [];
  const excludePaths = config.excludePaths ?? DEFAULT_EXCLUDE_PATHS;
  const redactHeaderPatterns = config.redactHeaders ?? DEFAULT_REDACT_HEADERS;
  const redactBodyPatterns = config.redactBodyFields ?? DEFAULT_REDACT_BODY_FIELDS;
  const requestBodyConfig = config.requestBody ?? { enabled: false };
  const responseBodyConfig = config.responseBody ?? { enabled: false };
  const includeHeaders = config.includeHeaders ?? true;
  const includeQuery = config.includeQuery ?? true;
  const includeClientIp = config.includeClientIp ?? true;
  const ipHeader = config.ipHeader ?? 'X-Forwarded-For';
  const trustProxy = config.trustProxy ?? false;
  const minResponseTimeMs = config.minResponseTimeMs ?? 0;
  const generateRequestId = config.generateRequestId ?? defaultGenerateRequestId;

  return async (ctx, next) => {
    // Skip if disabled
    if (!enabled) {
      return next();
    }

    // Check if path should be logged
    const path = ctx.req.path;
    if (shouldExcludePath(path, includePaths, excludePaths)) {
      return next();
    }

    // Generate request ID and start time
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Store in context for access by handlers
    setContextVar(ctx, 'requestId', requestId);
    setContextVar(ctx, 'requestStartTime', startTime);

    // Set X-Request-ID header in response
    ctx.header('X-Request-ID', requestId);

    // Capture request details
    const method = ctx.req.method;
    const url = ctx.req.url;

    // Extract headers if enabled
    let requestHeaders: Record<string, string> | undefined;
    if (includeHeaders) {
      const rawHeaders = extractHeaders(ctx.req.raw.headers);
      requestHeaders = redactHeaders(rawHeaders, redactHeaderPatterns);
    }

    // Extract query if enabled
    let query: Record<string, string> | undefined;
    if (includeQuery) {
      query = extractQuery(ctx);
    }

    // Extract client IP if enabled
    let clientIp: string | undefined;
    if (includeClientIp) {
      clientIp = extractClientIp(ctx, ipHeader, trustProxy);
    }

    // Extract user ID (may be set by auth middleware)
    const userId = extractUserId(ctx);

    // Capture request body if enabled
    let requestBody: unknown | undefined;
    if (requestBodyConfig.enabled) {
      const contentType = ctx.req.header('content-type');
      const allowedTypes = requestBodyConfig.contentTypes ?? [];

      if (isAllowedContentType(contentType, allowedTypes)) {
        try {
          // Clone the request to avoid consuming the body
          const clonedRequest = ctx.req.raw.clone();
          const bodyText = await clonedRequest.text();

          if (bodyText) {
            // Try to parse as JSON
            try {
              let parsed = JSON.parse(bodyText);
              // Redact sensitive fields
              parsed = redactObject(parsed, redactBodyPatterns);
              // Truncate if needed
              const maxSize = requestBodyConfig.maxSize ?? 10240;
              requestBody = truncateBody(parsed, maxSize);
            } catch {
              // Not JSON, store as string (truncated)
              const maxSize = requestBodyConfig.maxSize ?? 10240;
              requestBody = truncateBody(bodyText, maxSize);
            }
          }
        } catch {
          // Ignore body parsing errors
        }
      }
    }

    // Process the request
    let error: Error | undefined;
    let responseBody: unknown | undefined;

    try {
      await next();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      throw e;
    } finally {
      // Calculate response time
      const endTime = Date.now();
      const responseTimeMs = endTime - startTime;

      // Skip logging if below minimum response time
      if (responseTimeMs < minResponseTimeMs) {
        return;
      }

      // Get response status
      const statusCode = ctx.res.status;

      // Extract response headers if enabled
      let responseHeaders: Record<string, string> | undefined;
      if (includeHeaders) {
        const rawHeaders = extractHeaders(ctx.res.headers);
        responseHeaders = redactHeaders(rawHeaders, redactHeaderPatterns);
      }

      // Capture response body if enabled
      if (responseBodyConfig.enabled && !error) {
        const allowedStatuses = responseBodyConfig.statusCodes ?? [];

        if (allowedStatuses.length === 0 || allowedStatuses.includes(statusCode)) {
          try {
            // Clone response and read body as text
            const clonedResponse = ctx.res.clone();
            const bodyText = await clonedResponse.text();

            if (bodyText) {
              try {
                let parsed = JSON.parse(bodyText);
                parsed = redactObject(parsed, redactBodyPatterns);
                const maxSize = responseBodyConfig.maxSize ?? 10240;
                responseBody = truncateBody(parsed, maxSize);
              } catch {
                const maxSize = responseBodyConfig.maxSize ?? 10240;
                responseBody = truncateBody(bodyText, maxSize);
              }
            }
          } catch {
            // Ignore body parsing errors
          }
        }
      }

      // Determine log level
      let level: LogLevel = defaultLevel;
      if (config.levelResolver) {
        level = config.levelResolver(ctx, responseTimeMs, statusCode, error);
      } else if (error || statusCode >= 500) {
        level = 'error';
      } else if (statusCode >= 400) {
        level = 'warn';
      }

      // Build log entry
      let entry: LogEntry = {
        id: requestId,
        timestamp: new Date(startTime).toISOString(),
        level,
        request: {
          method,
          path,
          url,
          headers: requestHeaders,
          query,
          body: requestBody,
          clientIp,
          userId,
        },
        response: {
          statusCode,
          headers: responseHeaders,
          body: responseBody,
          responseTimeMs,
        },
      };

      // Add error information
      if (error) {
        entry.error = {
          message: error.message,
          name: error.name,
          stack: error.stack,
        };
      }

      // Add metadata
      if (config.metadata) {
        const metadata =
          typeof config.metadata === 'function' ? config.metadata(ctx) : config.metadata;
        entry.metadata = metadata;
      }

      // Apply formatter if provided
      if (config.formatter) {
        entry = config.formatter(entry);
      }

      // Store and handle entry (priority: config > context > global)
      const storage = resolveLoggingStorage(ctx, config.storage);

      const handleEntry = async () => {
        // Store in storage
        if (storage) {
          try {
            await storage.store(entry);
          } catch (storageError) {
            if (config.onError) {
              config.onError(storageError instanceof Error ? storageError : new Error(String(storageError)), entry);
            }
          }
        }

        // Call additional handlers
        if (config.handlers) {
          for (const handler of config.handlers) {
            try {
              await handler(entry);
            } catch (handlerError) {
              if (config.onError) {
                config.onError(handlerError instanceof Error ? handlerError : new Error(String(handlerError)), entry);
              }
            }
          }
        }
      };

      // Fire and forget - don't block the response
      // But ensure errors are reported via onError callback or console
      handleEntry().catch((err) => {
        const error = toError(err);
        if (config.onError) {
          config.onError(error, entry);
        } else {
          getLogger().error('Failed to process log entry', { error: error.message });
        }
      });
    }
  };
}
