import { MemoryTtlStore } from 'hono-crud/internal';
import type { IdempotencyEntry, IdempotencyStorage } from '../types';

/**
 * Options for MemoryIdempotencyStorage.
 */
export interface MemoryIdempotencyStorageOptions {
  /**
   * Minimum interval between lazy cleanup runs (ms). Cleanup happens on
   * access, not via background timers (edge-safe). Set 0 to disable.
   * @default 60_000 (1 minute)
   */
  cleanupInterval?: number;
  /** Maximum response entries before oldest-first eviction (0 = unlimited). @default 10_000 */
  maxEntries?: number;
}

/**
 * In-memory idempotency storage.
 * Ideal for development, testing, and single-instance deployments.
 *
 * Uses lazy cleanup-on-access (edge-safe: no background timers).
 *
 * **Caveats — not safe for multi-isolate production:**
 * - State is per process / per isolate. On Cloudflare Workers (and any
 *   multi-instance deployment) a retry may hit a DIFFERENT isolate with an
 *   empty store, so replay protection is NOT guaranteed exactly where it
 *   matters (duplicate charges). Use `RedisIdempotencyStorage` (Upstash is
 *   edge-compatible) for production.
 * - There is deliberately no Cloudflare KV backend: KV lacks compare-and-swap,
 *   so an atomic `lock()` cannot be implemented (see the package README).
 *
 * @example
 * ```ts
 * import { MemoryIdempotencyStorage } from '@hono-crud/idempotency';
 * import { createStorageMiddleware } from 'hono-crud/storage';
 *
 * app.use('*', createStorageMiddleware({
 *   idempotencyStorage: new MemoryIdempotencyStorage(),
 * }));
 * ```
 */
export class MemoryIdempotencyStorage implements IdempotencyStorage {
  /** Entry store. The wrapper carries the per-entry expiry timestamp. */
  private entryStore: MemoryTtlStore<{ entry: IdempotencyEntry; expiresAt: number }>;
  /** Lock store. The value IS the lock's expiry timestamp. */
  private lockStore: MemoryTtlStore<number>;

  /** Minimum interval between cleanup runs (ms) */
  private cleanupInterval: number;
  /** Timestamp of last cleanup run */
  private lastCleanup = 0;

  constructor(options?: MemoryIdempotencyStorageOptions) {
    this.cleanupInterval = options?.cleanupInterval ?? 60000;
    const maxEntries = options?.maxEntries ?? 10_000;
    // Both inner stores keep `cleanupInterval: 0` so their built-in
    // `maybeCleanup` is a no-op; the domain class owns the single guarded
    // lazy sweep over BOTH maps (see `maybeCleanup` below).
    this.entryStore = new MemoryTtlStore({
      isExpired: (wrapper, now) => now > wrapper.expiresAt,
      cleanupInterval: 0,
      maxEntries,
    });
    this.lockStore = new MemoryTtlStore<number>({
      isExpired: (expiresAt, now) => now > expiresAt,
      cleanupInterval: 0,
      maxEntries: 0,
    });
  }

  private maybeCleanup(): void {
    if (this.cleanupInterval <= 0) return;
    const now = Date.now();
    if (now - this.lastCleanup >= this.cleanupInterval) {
      this.lastCleanup = now;
      this.entryStore.cleanup(now);
      this.lockStore.cleanup(now);
    }
  }

  /**
   * Remove expired entries and locks.
   * @returns Number of expired entries and locks removed.
   */
  async cleanup(): Promise<number> {
    return this.entryStore.cleanup() + this.lockStore.cleanup();
  }

  async get(key: string): Promise<IdempotencyEntry | null> {
    this.maybeCleanup();
    const wrapper = this.entryStore.get(key);
    return wrapper ? wrapper.entry : null;
  }

  async set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void> {
    this.maybeCleanup();
    // Capacity eviction (oldest-first) happens inside the store.
    this.entryStore.set(key, { entry, expiresAt: Date.now() + ttlMs });
  }

  async isLocked(key: string): Promise<boolean> {
    // Expiry-on-read deletes a stale lock and reports it as absent.
    return this.lockStore.has(key);
  }

  async lock(key: string, ttlMs: number): Promise<boolean> {
    if (await this.isLocked(key)) return false;
    this.lockStore.set(key, Date.now() + ttlMs);
    return true;
  }

  async unlock(key: string): Promise<void> {
    this.lockStore.delete(key);
  }

  destroy(): void {
    this.entryStore.clear();
    this.lockStore.clear();
  }

  getSize(): number {
    return this.entryStore.size;
  }
}
