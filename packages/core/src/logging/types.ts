import type { Context, Env } from 'hono';

// ============================================================================
// Log Level
// ============================================================================

/**
 * Log severity levels.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ============================================================================
// Log Entry Types
// ============================================================================

/**
 * Request information for a log entry.
 */
export interface RequestLogEntry {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request path (without query string) */
  path: string;
  /** Full URL including query string */
  url: string;
  /** Request headers (may be redacted) */
  headers?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
  /** Request body (may be redacted or truncated) */
  body?: unknown;
  /** Client IP address */
  clientIp?: string;
  /** Authenticated user ID (if available) */
  userId?: string;
}

/**
 * Response information for a log entry.
 */
export interface ResponseLogEntry {
  /** HTTP status code */
  statusCode: number;
  /** Response headers (may be redacted) */
  headers?: Record<string, string>;
  /** Response body (may be redacted or truncated) */
  body?: unknown;
  /** Response time in milliseconds */
  responseTimeMs: number;
}

/**
 * Complete log entry combining request and response data.
 */
export interface LogEntry {
  /** Unique identifier for the log entry */
  id: string;
  /** When the request was received (ISO timestamp) */
  timestamp: string;
  /** Log level/severity */
  level: LogLevel;
  /** Request information */
  request: RequestLogEntry;
  /** Response information */
  response: ResponseLogEntry;
  /** Error information (if an error occurred) */
  error?: {
    /** Error message */
    message: string;
    /** Error name/type */
    name?: string;
    /** Error stack trace (if available) */
    stack?: string;
  };
  /** Additional custom metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Query Options
// ============================================================================

/**
 * Options for querying log entries.
 */
export interface LogQueryOptions {
  /** Filter by log level(s) */
  level?: LogLevel | LogLevel[];
  /** Filter by HTTP method(s) */
  method?: string | string[];
  /** Filter by path pattern (supports wildcards) */
  path?: string;
  /** Filter by status code range */
  statusCode?: {
    min?: number;
    max?: number;
  };
  /** Filter by time range */
  timeRange?: {
    /** Start time (ISO timestamp or Date) */
    start?: string | Date;
    /** End time (ISO timestamp or Date) */
    end?: string | Date;
  };
  /** Filter by user ID */
  userId?: string;
  /** Filter by client IP */
  clientIp?: string;
  /** Filter by request ID */
  requestId?: string;
  /** Search in error message */
  errorMessage?: string;
  /** Maximum number of entries to return */
  limit?: number;
  /** Number of entries to skip (for pagination) */
  offset?: number;
  /** Sort order */
  sort?: {
    field: 'timestamp' | 'responseTimeMs' | 'statusCode';
    direction: 'asc' | 'desc';
  };
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Storage interface for logging.
 */
export interface LoggingStorage {
  /**
   * Store a log entry.
   * @param entry - The log entry to store
   */
  store(entry: LogEntry): Promise<void>;

  /**
   * Query log entries with filtering and pagination.
   * @param options - Query options
   * @returns Matching log entries
   */
  query(options?: LogQueryOptions): Promise<LogEntry[]>;

  /**
   * Get a single log entry by ID.
   * @param id - The log entry ID
   * @returns The log entry or null if not found
   */
  getById(id: string): Promise<LogEntry | null>;

  /**
   * Count log entries matching the query.
   * @param options - Query options (limit/offset ignored)
   * @returns Number of matching entries
   */
  count(options?: LogQueryOptions): Promise<number>;

  /**
   * Delete log entries older than a given age.
   * @param maxAgeMs - Maximum age in milliseconds
   * @returns Number of entries deleted
   */
  deleteOlderThan(maxAgeMs: number): Promise<number>;

  /**
   * Clear all log entries.
   * @returns Number of entries cleared
   */
  clear(): Promise<number>;

  /**
   * Destroy the storage (cleanup intervals, connections, etc.).
   */
  destroy?(): void;
}

// ============================================================================
// Path Pattern
// ============================================================================

/**
 * Path pattern for include/exclude configuration.
 * Supports exact paths, wildcards, and regex.
 */
export type PathPattern = string | RegExp;

// ============================================================================
// Redaction Configuration
// ============================================================================

/**
 * Field pattern for redaction.
 * Can be a string (exact match or glob) or regex.
 */
export type RedactField = string | RegExp;

/**
 * Configuration for request body logging.
 */
export interface RequestBodyConfig {
  /** Enable request body logging */
  enabled?: boolean;
  /** Maximum body size to log (bytes). Larger bodies are truncated. */
  maxSize?: number;
  /** Content types to log (e.g., ['application/json']). Empty = all. */
  contentTypes?: string[];
}

/**
 * Configuration for response body logging.
 */
export interface ResponseBodyConfig {
  /** Enable response body logging */
  enabled?: boolean;
  /** Maximum body size to log (bytes). Larger bodies are truncated. */
  maxSize?: number;
  /** Status codes to log response body for. Empty = all. */
  statusCodes?: number[];
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the logging middleware.
 */
export interface LoggingConfig<E extends Env = Env> {
  /**
   * Enable/disable logging middleware.
   * @default true
   */
  enabled?: boolean;

  /**
   * Default log level.
   * @default 'info'
   */
  level?: LogLevel;

  /**
   * Custom function to determine log level based on request context.
   * Called after the response is complete.
   * Overrides the default level.
   */
  levelResolver?: (
    ctx: Context<E>,
    responseTimeMs: number,
    statusCode: number,
    error?: Error
  ) => LogLevel;

  /**
   * Paths to include for logging.
   * If empty, all paths are logged (unless excluded).
   * Supports exact paths, wildcards, and regex.
   * @default [] (all paths)
   */
  includePaths?: PathPattern[];

  /**
   * Paths to exclude from logging.
   * Takes precedence over includePaths.
   * @default ['/health', '/healthz', '/ready', '/metrics', '/favicon.ico']
   */
  excludePaths?: PathPattern[];

  /**
   * Header names/patterns to redact.
   * Values are replaced with '[REDACTED]'.
   * @default ['authorization', 'cookie', 'x-api-key']
   */
  redactHeaders?: RedactField[];

  /**
   * Body field names/patterns to redact.
   * Values are replaced with '[REDACTED]'.
   * Applied recursively to nested objects.
   * @default ['password', 'token', 'secret', 'apiKey', 'api_key']
   */
  redactBodyFields?: RedactField[];

  /**
   * Request body logging configuration.
   * @default { enabled: false }
   */
  requestBody?: RequestBodyConfig;

  /**
   * Response body logging configuration.
   * @default { enabled: false }
   */
  responseBody?: ResponseBodyConfig;

  /**
   * Include request headers in log entries.
   * @default true
   */
  includeHeaders?: boolean;

  /**
   * Include query parameters in log entries.
   * @default true
   */
  includeQuery?: boolean;

  /**
   * Include client IP in log entries.
   * @default true
   */
  includeClientIp?: boolean;

  /**
   * Header name to extract client IP from (when behind proxy).
   * @default 'X-Forwarded-For'
   */
  ipHeader?: string;

  /**
   * Whether to trust the proxy header for IP extraction.
   * @default false
   */
  trustProxy?: boolean;

  /**
   * Storage instance for log entries.
   * If not provided, uses the global storage (set via setLoggingStorage).
   */
  storage?: LoggingStorage;

  /**
   * Custom formatter to transform log entries before storage.
   * Can be used to add/remove fields or transform values.
   */
  formatter?: (entry: LogEntry) => LogEntry;

  /**
   * Additional handlers to call for each log entry.
   * Useful for sending logs to external services (e.g., console, file, APM).
   */
  handlers?: ((entry: LogEntry) => void | Promise<void>)[];

  /**
   * Static metadata to add to all log entries.
   * Can be an object or a function that receives the context.
   */
  metadata?: Record<string, unknown> | ((ctx: Context<E>) => Record<string, unknown>);

  /**
   * Error handler for logging failures.
   * Called when storage or handlers fail.
   */
  onError?: (error: Error, entry: LogEntry) => void;

  /**
   * Custom function to generate request IDs.
   * @default crypto.randomUUID()
   */
  generateRequestId?: () => string;

  /**
   * Minimum response time (ms) to log.
   * Requests faster than this are not logged.
   * Useful for filtering out fast, uninteresting requests.
   * @default 0 (log all)
   */
  minResponseTimeMs?: number;
}

// ============================================================================
// Environment Extension
// ============================================================================

/**
 * Hono environment variables for logging.
 * Extend your app's Env with this for type-safe context access.
 *
 * @example
 * ```ts
 * import type { LoggingEnv } from 'hono-crud';
 *
 * type AppEnv = LoggingEnv & {
 *   Variables: {
 *     // your other variables
 *   };
 * };
 *
 * const app = new Hono<AppEnv>();
 * ```
 */
export interface LoggingEnv extends Env {
  Variables: {
    /** Unique request ID */
    requestId?: string;
    /** Request start time (ms) */
    requestStartTime?: number;
  };
}
