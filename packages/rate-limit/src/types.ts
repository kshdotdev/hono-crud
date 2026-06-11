import type { Context, Env } from 'hono';
import type { RateLimitStorage } from 'hono-crud/internal';

// ============================================================================
// Storage Entry Types + Interface
// ============================================================================

/**
 * Rate-limit storage contracts are owned by core (`storage/contracts.ts`) so
 * `createStorageMiddleware` and the registries can resolve them. They are
 * re-exported here for ergonomic plugin-local imports. `windowMs` is unchanged.
 */
export type {
  FixedWindowEntry,
  SlidingWindowEntry,
  RateLimitEntry,
  RateLimitStorage,
} from 'hono-crud/internal';

// ============================================================================
// Rate Limit Result
// ============================================================================

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Maximum requests allowed per window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp when the limit resets (seconds) */
  resetAt: number;
  /** Seconds until the request can be retried (only when not allowed) */
  retryAfter?: number;
}

// ============================================================================
// Key Strategy
// ============================================================================

/**
 * Built-in key extraction strategies.
 * - 'ip': Use client IP address (works without auth)
 * - 'user': Use authenticated user ID (requires auth middleware)
 * - 'api-key': Use API key from header (requires API key auth)
 * - 'combined': Combine IP + user ID for more granular limiting
 */
export type KeyStrategy = 'ip' | 'user' | 'api-key' | 'combined';

/**
 * Custom key extraction function.
 */
export type KeyExtractor<E extends Env = Env> = (ctx: Context<E>) => string | null;

// ============================================================================
// Rate Limit Algorithm
// ============================================================================

/**
 * Rate limiting algorithm.
 * - 'fixed-window': Simple window-based limiting (resets at window boundary)
 * - 'sliding-window': More accurate limiting using sliding window (default)
 */
export type RateLimitAlgorithm = 'fixed-window' | 'sliding-window';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Tier configuration for dynamic rate limits.
 */
export interface RateLimitTier {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds?: number;
}

/**
 * Function to get tier-based rate limits.
 * Can return different limits based on user, route, or other context.
 */
export type TierFunction<E extends Env = Env> = (
  ctx: Context<E>,
) => RateLimitTier | Promise<RateLimitTier>;

/**
 * Callback when rate limit is exceeded.
 * Useful for logging or metrics.
 */
export type OnRateLimitExceeded<E extends Env = Env> = (
  ctx: Context<E>,
  result: RateLimitResult,
  key: string,
) => void | Promise<void>;

/**
 * Path pattern for skip configuration.
 * Supports exact paths, wildcards, and regex.
 */
export type PathPattern = string | RegExp;

/**
 * Configuration for the rate limit middleware.
 */
export interface RateLimitConfig<E extends Env = Env> {
  /**
   * Maximum number of requests allowed per window.
   * @default 100
   */
  limit?: number;

  /**
   * Window duration in seconds.
   * @default 60
   */
  windowSeconds?: number;

  /**
   * Rate limiting algorithm.
   * - 'fixed-window': Simple, resets at window boundaries
   * - 'sliding-window': More accurate, no boundary bursts
   * @default 'sliding-window'
   */
  algorithm?: RateLimitAlgorithm;

  /**
   * Key extraction strategy or custom function.
   * @default 'ip'
   */
  keyStrategy?: KeyStrategy | KeyExtractor<E>;

  /**
   * Storage instance for rate limit data.
   * If not provided, uses the global storage (set via setRateLimitStorage).
   */
  storage?: RateLimitStorage;

  /**
   * Prefix for storage keys.
   * Useful for namespacing different rate limiters. This is the single source
   * of key namespacing — storage adapters add no prefix of their own by
   * default, so persisted keys are `<keyPrefix>:<path>:<clientKey>`.
   * @default 'rl' (`DEFAULT_RATE_LIMIT_KEY_PREFIX`)
   */
  keyPrefix?: string;

  /**
   * Paths to skip rate limiting.
   * Supports exact paths ('/health'), wildcards ('/public/*'), and regex.
   * @default []
   */
  skipPaths?: PathPattern[];

  /**
   * Whether to include rate limit headers in responses.
   * Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
   * @default true
   */
  includeHeaders?: boolean;

  /**
   * Custom function to get tier-based rate limits.
   * Overrides the default limit/windowSeconds for dynamic limiting.
   */
  getTier?: TierFunction<E>;

  /**
   * Callback when rate limit is exceeded.
   * Useful for logging or metrics.
   */
  onRateLimitExceeded?: OnRateLimitExceeded<E>;

  /**
   * Header name to extract client IP from (when behind proxy).
   * Common values: 'X-Forwarded-For', 'X-Real-IP', 'CF-Connecting-IP'
   * @default 'X-Forwarded-For'
   */
  ipHeader?: string;

  /**
   * Whether to trust the proxy header for IP extraction.
   * Set to true if behind a trusted proxy.
   * @default false
   */
  trustProxy?: boolean;

  /**
   * Header name to extract API key from (for 'api-key' strategy).
   * @default 'X-API-Key'
   */
  apiKeyHeader?: string;

  /**
   * Custom error message when rate limit is exceeded.
   * @default 'Too many requests'
   */
  errorMessage?: string;
}

// ============================================================================
// Environment Extension
// ============================================================================

/**
 * Hono environment variables for rate limiting.
 * Extend your app's Env with this for type-safe context access.
 *
 * @example
 * ```ts
 * import type { RateLimitEnv } from '@hono-crud/rate-limit';
 *
 * type AppEnv = RateLimitEnv & {
 *   Variables: {
 *     // your other variables
 *   };
 * };
 *
 * const app = new Hono<AppEnv>();
 * ```
 */
export interface RateLimitEnv extends Env {
  Variables: {
    /** Rate limit result for the current request */
    rateLimit?: RateLimitResult;
    /** Rate limit key used for the current request */
    rateLimitKey?: string;
  };
}
