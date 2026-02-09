import type { IdempotencyStorage, IdempotencyEntry } from '../types';

/**
 * In-memory idempotency storage.
 * Ideal for development, testing, and single-instance deployments.
 *
 * Uses lazy cleanup-on-access (edge-safe: no background timers).
 *
 * @example
 * ```ts
 * import { MemoryIdempotencyStorage, setIdempotencyStorage } from 'hono-crud';
 *
 * setIdempotencyStorage(new MemoryIdempotencyStorage());
 * ```
 */
export class MemoryIdempotencyStorage implements IdempotencyStorage {
  private entries = new Map<string, { entry: IdempotencyEntry; expiresAt: number }>();
  private locks = new Map<string, number>();

  /** Minimum interval between cleanup runs (ms) */
  private cleanupInterval: number;
  /** Timestamp of last cleanup run */
  private lastCleanup: number = 0;

  constructor(options?: { cleanupInterval?: number }) {
    this.cleanupInterval = options?.cleanupInterval ?? 60000;
  }

  private maybeCleanup(): void {
    if (this.cleanupInterval <= 0) return;
    const now = Date.now();
    if (now - this.lastCleanup >= this.cleanupInterval) {
      this.lastCleanup = now;
      this.cleanupExpired();
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.entries.entries()) {
      if (now > value.expiresAt) {
        this.entries.delete(key);
      }
    }
    for (const [key, expiresAt] of this.locks.entries()) {
      if (now > expiresAt) {
        this.locks.delete(key);
      }
    }
  }

  async get(key: string): Promise<IdempotencyEntry | null> {
    this.maybeCleanup();
    const stored = this.entries.get(key);
    if (!stored) return null;
    if (Date.now() > stored.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return stored.entry;
  }

  async set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void> {
    this.maybeCleanup();
    this.entries.set(key, {
      entry,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async isLocked(key: string): Promise<boolean> {
    const expiresAt = this.locks.get(key);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }

  async lock(key: string, ttlMs: number): Promise<boolean> {
    if (await this.isLocked(key)) return false;
    this.locks.set(key, Date.now() + ttlMs);
    return true;
  }

  async unlock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  destroy(): void {
    this.entries.clear();
    this.locks.clear();
  }

  getSize(): number {
    return this.entries.size;
  }
}
