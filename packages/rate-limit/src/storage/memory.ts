import { MemoryTtlStore } from 'hono-crud/internal';
import type {
  FixedWindowEntry,
  RateLimitEntry,
  RateLimitStorage,
  SlidingWindowEntry,
} from '../types';

/**
 * Options for MemoryRateLimitStorage.
 */
export interface MemoryRateLimitStorageOptions {
  /**
   * Minimum interval between automatic cleanup runs (ms).
   * Cleanup is performed lazily on access rather than via background timers,
   * making this compatible with edge runtimes (Cloudflare Workers, Deno, Bun).
   * Set to 0 to disable automatic cleanup.
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number;
}

/**
 * Wrapper folding the entry together with its expiration timestamp so a single
 * {@link MemoryTtlStore} owns both (replacing the old separate `expirations` Map).
 */
interface RateLimitWrapper {
  entry: RateLimitEntry;
  /** Expiration timestamp (ms). Entry is expired once `now > expiresAt`. */
  expiresAt: number;
}

/**
 * In-memory rate limit storage implementation.
 * Ideal for development, testing, and single-instance deployments.
 *
 * Features:
 * - Atomic increment operations
 * - Automatic cleanup of expired entries
 * - Both fixed and sliding window support
 *
 * Note: This storage is not shared across processes/instances.
 * Use Redis storage for multi-instance deployments.
 *
 * Cleanup is performed lazily on access (no background timers),
 * making this compatible with edge runtimes like Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { MemoryRateLimitStorage, setRateLimitStorage } from 'hono-crud';
 *
 * const storage = new MemoryRateLimitStorage();
 * setRateLimitStorage(storage);
 * ```
 */
export class MemoryRateLimitStorage implements RateLimitStorage {
  /** Main storage: key -> { entry, expiresAt } wrapper. */
  private store: MemoryTtlStore<RateLimitWrapper>;

  constructor(options?: MemoryRateLimitStorageOptions) {
    this.store = new MemoryTtlStore<RateLimitWrapper>({
      isExpired: (wrapper, now) => now > wrapper.expiresAt,
      cleanupInterval: options?.cleanupInterval ?? 60000,
      maxEntries: 0,
    });
  }

  /**
   * Increment the request count for a key (fixed window).
   * Creates the entry if it doesn't exist or window has expired.
   */
  async increment(key: string, windowMs: number): Promise<FixedWindowEntry> {
    this.store.maybeCleanup();
    const now = Date.now();
    // peek: read the raw wrapper without expiry-deleting it mid-mutation.
    const wrapper = this.store.peek(key);
    const existing = wrapper?.entry as FixedWindowEntry | undefined;

    // Check if we have a valid existing entry within the current window.
    if (existing && 'count' in existing && now < existing.windowStart + windowMs) {
      // Within current window: increment the live entry in place. The wrapper is
      // the same object the store holds, and the fixed-window expiry stays at
      // `windowStart + windowMs` (do NOT slide it), so no re-set is needed.
      existing.count++;
      return existing;
    }

    // Start new window and set its expiry.
    const entry: FixedWindowEntry = {
      count: 1,
      windowStart: now,
    };
    this.store.set(key, { entry, expiresAt: now + windowMs });

    return entry;
  }

  /**
   * Add a timestamp to the sliding window for a key.
   * Removes timestamps outside the window.
   */
  async addTimestamp(key: string, windowMs: number, now?: number): Promise<SlidingWindowEntry> {
    this.store.maybeCleanup();
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - windowMs;

    // peek: read the raw wrapper without expiry-deleting it mid-mutation.
    const wrapper = this.store.peek(key);
    const existing = wrapper?.entry as SlidingWindowEntry | undefined;

    let timestamps: number[];
    if (existing && 'timestamps' in existing) {
      // Filter out expired timestamps and add new one.
      timestamps = existing.timestamps.filter((t) => t > windowStart);
      timestamps.push(currentTime);
      existing.timestamps = timestamps;
      // Sliding window refreshes expiry every call (window duration from now).
      this.store.set(key, { entry: existing, expiresAt: currentTime + windowMs });
    } else {
      // Create new entry.
      timestamps = [currentTime];
      this.store.set(key, { entry: { timestamps }, expiresAt: currentTime + windowMs });
    }

    return { timestamps };
  }

  /**
   * Get the current entry for a key.
   */
  async get(key: string): Promise<RateLimitEntry | null> {
    this.store.maybeCleanup();
    const wrapper = this.store.get(key);
    return wrapper ? wrapper.entry : null;
  }

  /**
   * Reset the rate limit for a key.
   */
  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Clean up expired entries.
   */
  async cleanup(): Promise<number> {
    return this.store.cleanup();
  }

  /**
   * Destroy the storage and clear all data.
   */
  destroy(): void {
    this.store.clear();
  }

  /**
   * Get the number of entries (for debugging/monitoring).
   */
  getSize(): number {
    return this.store.size;
  }

  /**
   * Get all keys (for debugging).
   */
  getKeys(): string[] {
    return this.store.getKeys();
  }
}
