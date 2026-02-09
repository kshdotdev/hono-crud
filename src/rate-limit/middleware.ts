import type { Context, Env, MiddlewareHandler } from 'hono';
import { getLogger } from '../core/logger';
import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitStorage,
  KeyStrategy,
  KeyExtractor,
  FixedWindowEntry,
  SlidingWindowEntry,
} from './types';
import { RateLimitExceededException } from './exceptions';
import { extractIP, extractUserId, extractAPIKey, shouldSkipPath, generateKey } from './utils';
import { resolveRateLimitStorage } from '../storage/helpers';
import { setContextVar } from '../core/context-helpers';
import { createNullableRegistry } from '../storage/registry';

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Global rate limit storage registry.
 * Nullable -- no default storage is created unless explicitly set.
 */
export const rateLimitStorageRegistry = createNullableRegistry<RateLimitStorage>(
  'rateLimitStorage'
);

/**
 * Set the global rate limit storage.
 * Used when storage is not provided in middleware config.
 *
 * @example
 * ```ts
 * import { setRateLimitStorage, MemoryRateLimitStorage } from 'hono-crud';
 *
 * setRateLimitStorage(new MemoryRateLimitStorage());
 * ```
 */
export function setRateLimitStorage(storage: RateLimitStorage): void {
  rateLimitStorageRegistry.set(storage);
}

/**
 * Get the global rate limit storage.
 * @returns The global storage or null if not set
 */
export function getRateLimitStorage(): RateLimitStorage | null {
  return rateLimitStorageRegistry.get();
}

// ============================================================================
// Key Extraction
// ============================================================================

/**
 * Key extractor factory type.
 */
type KeyExtractorFactory<E extends Env> = (config: RateLimitConfig<E>) => KeyExtractor<E>;

/**
 * Create key extractor factories for each strategy.
 * Returns a function that creates the extractor with the given config.
 */
function createKeyExtractorFactories<E extends Env>(): Record<KeyStrategy, KeyExtractorFactory<E>> {
  return {
    ip: (config) => (ctx) => extractIP(ctx, config.ipHeader, config.trustProxy),

    user: (config) => (ctx) => {
      const userId = extractUserId(ctx);
      if (!userId) {
        // Fall back to IP if user not authenticated
        return extractIP(ctx, config.ipHeader, config.trustProxy);
      }
      return `user:${userId}`;
    },

    'api-key': (config) => (ctx) => {
      const apiKey = extractAPIKey(ctx, config.apiKeyHeader);
      if (!apiKey) {
        // Fall back to IP if no API key
        return extractIP(ctx, config.ipHeader, config.trustProxy);
      }
      // Don't use the raw key, use a hash or truncated version
      return `apikey:${apiKey.substring(0, 8)}`;
    },

    combined: (config) => (ctx) => {
      const ip = extractIP(ctx, config.ipHeader, config.trustProxy);
      const userId = extractUserId(ctx);
      if (userId) {
        return `${ip}:user:${userId}`;
      }
      return ip;
    },
  };
}

/**
 * Get the key extractor function for a strategy.
 * Uses a factory map for O(1) lookup instead of switch statement.
 */
function getKeyExtractor<E extends Env>(
  strategy: KeyStrategy | KeyExtractor<E>,
  config: RateLimitConfig<E>
): KeyExtractor<E> {
  if (typeof strategy === 'function') {
    return strategy;
  }

  const factories = createKeyExtractorFactories<E>();
  const factory = factories[strategy];

  if (factory) {
    return factory(config);
  }

  // Default to IP-based extraction
  return (ctx: Context<E>) => extractIP(ctx, config.ipHeader, config.trustProxy);
}

// ============================================================================
// Rate Limit Algorithms
// ============================================================================

/**
 * Perform fixed window rate limiting.
 */
async function checkFixedWindow(
  storage: RateLimitStorage,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const entry = await storage.increment(key, windowMs);

  const resetAt = Math.ceil((entry.windowStart + windowMs) / 1000);
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfter: allowed ? undefined : Math.ceil((entry.windowStart + windowMs - Date.now()) / 1000),
  };
}

/**
 * Perform sliding window rate limiting.
 */
async function checkSlidingWindow(
  storage: RateLimitStorage,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const entry = await storage.addTimestamp(key, windowMs, now);

  const count = entry.timestamps.length;
  const remaining = Math.max(0, limit - count);
  const allowed = count <= limit;

  // Reset time is when the oldest timestamp in the window expires
  const oldestTimestamp = entry.timestamps.length > 0 ? Math.min(...entry.timestamps) : now;
  const resetAt = Math.ceil((oldestTimestamp + windowMs) / 1000);

  // Retry after is when the oldest request falls outside the window
  let retryAfter: number | undefined;
  if (!allowed && entry.timestamps.length > 0) {
    // Find when enough requests will have expired to allow this one
    const sortedTimestamps = [...entry.timestamps].sort((a, b) => a - b);
    const excessCount = count - limit;
    if (excessCount > 0 && sortedTimestamps.length >= excessCount) {
      const earliestNeededExpiry = sortedTimestamps[excessCount - 1];
      retryAfter = Math.max(1, Math.ceil((earliestNeededExpiry + windowMs - now) / 1000));
    }
  }

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfter,
  };
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates rate limit middleware.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import {
 *   createRateLimitMiddleware,
 *   setRateLimitStorage,
 *   MemoryRateLimitStorage,
 * } from 'hono-crud';
 *
 * // Setup storage (do this once at startup)
 * setRateLimitStorage(new MemoryRateLimitStorage());
 *
 * const app = new Hono();
 *
 * // Global rate limit: 100 requests per minute
 * app.use('*', createRateLimitMiddleware({
 *   limit: 100,
 *   windowSeconds: 60,
 *   keyStrategy: 'ip',
 *   skipPaths: ['/health', '/docs/*'],
 * }));
 *
 * // Stricter limit for expensive endpoint
 * app.use('/api/export/*', createRateLimitMiddleware({
 *   limit: 5,
 *   windowSeconds: 60,
 *   keyPrefix: 'rl:export',
 * }));
 * ```
 *
 * @example
 * ```ts
 * // Per-user rate limiting with tiers
 * app.use('/api/*', createRateLimitMiddleware({
 *   keyStrategy: 'user',
 *   getTier: async (ctx) => {
 *     const user = ctx.get('user');
 *     if (user?.roles?.includes('premium')) {
 *       return { limit: 1000, windowSeconds: 60 };
 *     }
 *     return { limit: 100, windowSeconds: 60 };
 *   },
 * }));
 * ```
 */
export function createRateLimitMiddleware<E extends Env = Env>(
  config: RateLimitConfig<E> = {}
): MiddlewareHandler<E> {
  // Default configuration
  const limit = config.limit ?? 100;
  const windowSeconds = config.windowSeconds ?? 60;
  const algorithm = config.algorithm ?? 'sliding-window';
  const keyStrategy = config.keyStrategy ?? 'ip';
  const keyPrefix = config.keyPrefix ?? 'rl';
  const skipPaths = config.skipPaths ?? [];
  const includeHeaders = config.includeHeaders ?? true;
  const errorMessage = config.errorMessage ?? 'Too many requests';

  // Get key extractor
  const extractKey = getKeyExtractor(keyStrategy, config);

  return async (ctx, next) => {
    // Check if path should skip rate limiting
    const path = ctx.req.path;
    if (skipPaths.length > 0 && shouldSkipPath(path, skipPaths)) {
      return next();
    }

    // Get storage (priority: config > context > global)
    const storage = resolveRateLimitStorage(ctx, config.storage);
    if (!storage) {
      getLogger().warn('Rate limit storage not configured. Skipping rate limiting.');
      return next();
    }

    // Extract key
    const clientKey = extractKey(ctx);
    if (!clientKey) {
      // Can't identify client, skip rate limiting
      return next();
    }

    // Get tier-based limits if configured
    let effectiveLimit = limit;
    let effectiveWindowSeconds = windowSeconds;

    if (config.getTier) {
      const tier = await config.getTier(ctx);
      effectiveLimit = tier.limit;
      effectiveWindowSeconds = tier.windowSeconds ?? windowSeconds;
    }

    const windowMs = effectiveWindowSeconds * 1000;

    // Generate full key
    const fullKey = generateKey(keyPrefix, path, clientKey);

    // Check rate limit
    let result: RateLimitResult;

    if (algorithm === 'fixed-window') {
      result = await checkFixedWindow(storage, fullKey, effectiveLimit, windowMs);
    } else {
      result = await checkSlidingWindow(storage, fullKey, effectiveLimit, windowMs);
    }

    // Store result in context for access by handlers
    setContextVar(ctx, 'rateLimit', result);
    setContextVar(ctx, 'rateLimitKey', fullKey);

    // Add headers if enabled
    if (includeHeaders) {
      ctx.header('X-RateLimit-Limit', String(result.limit));
      ctx.header('X-RateLimit-Remaining', String(result.remaining));
      ctx.header('X-RateLimit-Reset', String(result.resetAt));
    }

    // Check if rate limit exceeded
    if (!result.allowed) {
      // Add Retry-After header
      if (result.retryAfter) {
        ctx.header('Retry-After', String(result.retryAfter));
      }

      // Call callback if configured
      if (config.onRateLimitExceeded) {
        await config.onRateLimitExceeded(ctx, result, fullKey);
      }

      // Throw exception
      throw new RateLimitExceededException(errorMessage, result.retryAfter ?? 60);
    }

    await next();
  };
}

/**
 * Reset rate limit for a specific key.
 * Useful for administrative functions or after successful verification.
 *
 * @param key - The rate limit key to reset
 * @param storage - Optional storage instance (uses global if not provided)
 */
export async function resetRateLimit(
  key: string,
  storage?: RateLimitStorage
): Promise<void> {
  const effectiveStorage = storage ?? rateLimitStorageRegistry.get();
  if (!effectiveStorage) {
    throw new Error('Rate limit storage not configured');
  }
  await effectiveStorage.reset(key);
}
