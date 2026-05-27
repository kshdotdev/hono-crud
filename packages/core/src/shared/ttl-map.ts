/**
 * TTL-aware Map primitive for in-memory storage backends.
 * Edge-safe: lazy cleanup on access, no background timers.
 *
 * Used by: cache/, idempotency/, rate-limit/, logging/, audit/, versioning/
 * memory storage implementations to share Map+TTL+eviction logic.
 */

export interface TtlMapOptions {
  /** Cleanup interval in ms (0 disables lazy cleanup). */
  cleanupInterval?: number;
  /** Maximum number of entries before oldest is evicted (0 = unlimited). */
  maxEntries?: number;
}

interface TtlEntry<V> {
  value: V;
  expiresAt: number | null;
}

export class TtlMap<V> {
  private entries = new Map<string, TtlEntry<V>>();
  private cleanupInterval: number;
  private maxEntries: number;
  private lastCleanup = 0;

  constructor(options?: TtlMapOptions) {
    this.cleanupInterval = options?.cleanupInterval ?? 60_000;
    this.maxEntries = options?.maxEntries ?? 10_000;
  }

  set(key: string, value: V, ttlMs?: number): void {
    this.maybeCleanup();
    if (this.maxEntries > 0 && this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictOldest();
    }
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      value,
      expiresAt: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : null,
    });
  }

  get(key: string): V | undefined {
    this.maybeCleanup();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  *valuesWithKeys(): IterableIterator<[string, V]> {
    for (const [k, e] of this.entries) {
      if (e.expiresAt !== null && e.expiresAt < Date.now()) continue;
      yield [k, e.value];
    }
  }

  /** Run cleanup if `cleanupInterval` ms have passed since the last run. */
  maybeCleanup(): void {
    if (this.cleanupInterval <= 0) return;
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;
    this.lastCleanup = now;
    this.cleanup();
  }

  /** Force-cleanup all expired entries; returns count removed. */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) {
      this.entries.delete(oldest);
    }
  }
}
