import type { RateLimitStorage, FixedWindowEntry, SlidingWindowEntry, RateLimitEntry } from '../types';

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
  /** Main storage: key -> entry */
  private storage = new Map<string, RateLimitEntry>();

  /** Expiration times: key -> expiration timestamp (ms) */
  private expirations = new Map<string, number>();

  /** Minimum interval between cleanup runs (ms) */
  private cleanupInterval: number;

  /** Timestamp of last cleanup run */
  private lastCleanup: number = 0;

  constructor(options?: MemoryRateLimitStorageOptions) {
    this.cleanupInterval = options?.cleanupInterval ?? 60000;
  }

  /**
   * Runs cleanup if enough time has passed since last cleanup.
   * Called lazily on access to avoid background timers.
   */
  private maybeCleanup(): void {
    if (this.cleanupInterval <= 0) return;
    const now = Date.now();
    if (now - this.lastCleanup >= this.cleanupInterval) {
      this.lastCleanup = now;
      this.cleanupSync();
    }
  }

  /**
   * Synchronous cleanup of expired entries.
   */
  private cleanupSync(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, expiration] of this.expirations.entries()) {
      if (now > expiration) {
        this.storage.delete(key);
        this.expirations.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Increment the request count for a key (fixed window).
   * Creates the entry if it doesn't exist or window has expired.
   */
  async increment(key: string, windowMs: number): Promise<FixedWindowEntry> {
    this.maybeCleanup();
    const now = Date.now();
    const existing = this.storage.get(key) as FixedWindowEntry | undefined;

    // Check if we have a valid existing entry
    if (existing && 'count' in existing) {
      const windowEnd = existing.windowStart + windowMs;

      if (now < windowEnd) {
        // Within current window, increment
        existing.count++;
        return existing;
      }
    }

    // Start new window
    const entry: FixedWindowEntry = {
      count: 1,
      windowStart: now,
    };

    this.storage.set(key, entry);
    this.expirations.set(key, now + windowMs);

    return entry;
  }

  /**
   * Add a timestamp to the sliding window for a key.
   * Removes timestamps outside the window.
   */
  async addTimestamp(key: string, windowMs: number, now?: number): Promise<SlidingWindowEntry> {
    this.maybeCleanup();
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - windowMs;

    const existing = this.storage.get(key) as SlidingWindowEntry | undefined;

    let timestamps: number[];
    if (existing && 'timestamps' in existing) {
      // Filter out expired timestamps and add new one
      timestamps = existing.timestamps.filter((t) => t > windowStart);
      timestamps.push(currentTime);
      existing.timestamps = timestamps;
    } else {
      // Create new entry
      timestamps = [currentTime];
      const entry: SlidingWindowEntry = { timestamps };
      this.storage.set(key, entry);
    }

    // Set expiration (window duration from now)
    this.expirations.set(key, currentTime + windowMs);

    return { timestamps };
  }

  /**
   * Get the current entry for a key.
   */
  async get(key: string): Promise<RateLimitEntry | null> {
    this.maybeCleanup();
    const entry = this.storage.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    const expiration = this.expirations.get(key);
    if (expiration && Date.now() > expiration) {
      this.storage.delete(key);
      this.expirations.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Reset the rate limit for a key.
   */
  async reset(key: string): Promise<void> {
    this.storage.delete(key);
    this.expirations.delete(key);
  }

  /**
   * Clean up expired entries.
   */
  async cleanup(): Promise<number> {
    return this.cleanupSync();
  }

  /**
   * Destroy the storage and clear all data.
   */
  destroy(): void {
    this.storage.clear();
    this.expirations.clear();
  }

  /**
   * Get the number of entries (for debugging/monitoring).
   */
  getSize(): number {
    return this.storage.size;
  }

  /**
   * Get all keys (for debugging).
   */
  getKeys(): string[] {
    return Array.from(this.storage.keys());
  }
}
