/**
 * Structured logger for hono-crud.
 *
 * Provides a centralised logging interface that can be overridden by users
 * to integrate with their own logging infrastructure.
 *
 * @example
 * ```ts
 * import { setLogger } from 'hono-crud';
 *
 * // Replace the default console logger with pino
 * setLogger({
 *   warn(msg, ctx) { pino.warn(ctx, msg); },
 *   error(msg, ctx) { pino.error(ctx, msg); },
 * });
 * ```
 */

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  warn(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.warn(`[hono-crud] ${message}`, context);
    } else {
      console.warn(`[hono-crud] ${message}`);
    }
  },
  error(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.error(`[hono-crud] ${message}`, context);
    } else {
      console.error(`[hono-crud] ${message}`);
    }
  },
};

let currentLogger: Logger = defaultLogger;

/** Replace the default logger with a custom implementation. */
export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

/** Get the current logger instance. */
export function getLogger(): Logger {
  return currentLogger;
}
