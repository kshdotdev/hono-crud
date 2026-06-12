/**
 * Cross-package storage contracts owned by core.
 *
 * Core owns the three storage interfaces (`CacheStorage`, `RateLimitStorage`,
 * `IdempotencyStorage`) that first-party `@hono-crud/*` plugins implement and
 * that `storage/types.ts` references. Plugins re-export these from
 * `hono-crud/internal` rather than re-declaring them, keeping the dependency
 * graph plugin → core (the only sanctioned cross-package bridge).
 *
 * Storage-boundary convention: durations crossing the storage boundary are
 * milliseconds (`ttlMs`); user-facing config types (e.g. `CacheConfig.ttl`)
 * stay in seconds and live in the plugins.
 */

// ============================================================================
// Cache storage
// ============================================================================

/**
 * Cache entry stored in the cache storage.
 */
export interface CacheEntry<T = unknown> {
  data: T;
  /** Epoch milliseconds when the entry was created. */
  createdAt: number;
  /** Epoch milliseconds when the entry expires, or null for no expiration. */
  expiresAt: number | null;
  tags?: string[];
}

/**
 * Options for setting cache entries.
 */
export interface CacheSetOptions {
  /** Time-to-live in milliseconds. */
  ttlMs?: number;
  /** Tags for group invalidation. */
  tags?: string[];
}

/**
 * Cache storage interface.
 * Implement this interface for custom storage backends.
 */
export interface CacheStorage {
  /**
   * Get a cached entry by key.
   * @returns The cached entry or null if not found/expired.
   */
  get<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Set a cache entry.
   * @param key - The cache key.
   * @param data - The data to cache.
   * @param options - Cache options (ttlMs, tags).
   */
  set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Delete a cache entry by key.
   * @returns True if the entry was deleted.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete entries matching a glob-style pattern.
   * @param pattern - Glob pattern (e.g., "users:*").
   * @returns Number of deleted entries.
   */
  deletePattern(pattern: string): Promise<number>;

  /**
   * Delete all entries with a specific tag.
   * @param tag - The tag to match.
   * @returns Number of deleted entries.
   */
  deleteByTag?(tag: string): Promise<number>;

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all cache entries.
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics (optional).
   */
  getStats?(): CacheStats;

  /**
   * Remove expired entries. Optional, edge-safe (no background timers).
   * @returns Number of entries removed.
   */
  cleanup?(): Promise<number>;

  /** Release resources (timers, connections). Optional, edge-safe. */
  destroy?(): void;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

// ============================================================================
// Rate-limit storage
// ============================================================================

/**
 * Entry for fixed window rate limiting.
 * Stores the count and window start time.
 */
export interface FixedWindowEntry {
  /** Number of requests in current window */
  count: number;
  /** Unix timestamp when the window started (ms) */
  windowStart: number;
}

/**
 * Entry for sliding window rate limiting.
 * Stores timestamps of requests within the window.
 */
export interface SlidingWindowEntry {
  /** Timestamps of requests within the window (ms) */
  timestamps: number[];
}

/**
 * Combined entry type for storage.
 */
export type RateLimitEntry = FixedWindowEntry | SlidingWindowEntry;

/**
 * Storage interface for rate limiting.
 * Separate from CacheStorage due to different requirements:
 * - Needs atomic increment operations
 * - No need for tags or complex queries
 * - Different data structure (counts/timestamps vs cached data)
 */
export interface RateLimitStorage {
  /**
   * Increment the request count for a key (fixed window).
   * Creates the entry if it doesn't exist.
   * @param key - The rate limit key
   * @param windowMs - Window duration in milliseconds
   * @returns The updated entry with count and window start
   */
  increment(key: string, windowMs: number): Promise<FixedWindowEntry>;

  /**
   * Add a timestamp to the sliding window for a key.
   * Removes timestamps outside the window.
   * @param key - The rate limit key
   * @param windowMs - Window duration in milliseconds
   * @param now - Current timestamp (optional, defaults to Date.now())
   * @returns The updated entry with all timestamps in window
   */
  addTimestamp(key: string, windowMs: number, now?: number): Promise<SlidingWindowEntry>;

  /**
   * Get the current entry for a key.
   * @param key - The rate limit key
   * @returns The entry or null if not found
   */
  get(key: string): Promise<RateLimitEntry | null>;

  /**
   * Reset the rate limit for a key.
   * @param key - The rate limit key
   */
  reset(key: string): Promise<void>;

  /**
   * Clean up expired entries.
   * @returns Number of entries removed
   */
  cleanup(): Promise<number>;

  /**
   * Destroy the storage (cleanup intervals, connections, etc.).
   */
  destroy?(): void;
}

// ============================================================================
// Idempotency storage
// ============================================================================

/**
 * Stored idempotency response entry.
 */
export interface IdempotencyEntry {
  /** The idempotency key */
  key: string;
  /** HTTP status code of the cached response */
  statusCode: number;
  /** Serialized response body */
  body: string;
  /** Response headers to replay */
  headers: Record<string, string>;
  /** Timestamp when the entry was created */
  createdAt: number;
}

/**
 * Storage interface for idempotency keys.
 */
export interface IdempotencyStorage {
  /**
   * Get a stored idempotency entry.
   * Returns null if the key doesn't exist or has expired.
   */
  get(key: string): Promise<IdempotencyEntry | null>;

  /**
   * Store an idempotency entry with a TTL.
   * @param key - The idempotency key
   * @param entry - The response entry to store
   * @param ttlMs - Time-to-live in milliseconds
   */
  set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void>;

  /**
   * Check if a key is currently being processed (in-flight lock).
   * Used to prevent concurrent requests with the same key.
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Acquire a lock for a key being processed.
   * Returns true if the lock was acquired, false if already locked.
   *
   * MUST be atomic (compare-and-set, e.g. Redis `SET NX PX`). This is why
   * there is deliberately no Cloudflare KV backend for idempotency: KV has no
   * compare-and-swap, so a KV lock would be advisory only — a correctness
   * footgun for the one feature whose failure mode is duplicate side effects.
   * Workers users should use Upstash Redis (or a future Durable Objects backend).
   */
  lock(key: string, ttlMs: number): Promise<boolean>;

  /**
   * Release a lock for a key.
   */
  unlock(key: string): Promise<void>;

  /**
   * Remove expired entries and locks. Optional, edge-safe.
   * @returns Number of entries removed.
   */
  cleanup?(): Promise<number>;

  /** Release resources and clear all data. Optional, edge-safe. */
  destroy?(): void;
}
