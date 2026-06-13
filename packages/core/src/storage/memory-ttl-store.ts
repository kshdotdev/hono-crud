/**
 * Generic, edge-safe TTL Map store composed by the cache, rate-limit, and
 * idempotency in-memory backends. Insertion-order keyed with lazy
 * cleanup-on-access, optional capacity eviction, count-returning sweep, and
 * debug accessors. Value-shape agnostic: the owner supplies an `isExpired`
 * predicate and (optionally) an `onEvict` hook so domain side-indices (e.g. the
 * cache tag index) stay consistent.
 */

/** Options for {@link MemoryTtlStore}. All durations are milliseconds. */
export interface MemoryTtlStoreOptions<V> {
  /** Predicate deciding whether a stored value is expired at `now`. Called on
   *  read (get/has) and during sweeps. Must be pure. */
  isExpired: (value: V, now: number) => boolean;

  /** Minimum interval between lazy cleanup-on-access sweeps (ms). `<= 0`
   *  disables lazy sweeping (explicit `cleanup()` still works). @default 0 */
  cleanupIntervalMs?: number;

  /** Maximum entries before evicting the oldest (insertion order). `<= 0`
   *  disables capacity eviction. @default 0 (unlimited) */
  maxEntries?: number;

  /** Invoked synchronously with key+value of every entry removed by eviction,
   *  expiry-on-read, sweep, or `delete()` — used by owners with side-indices
   *  (e.g. cache tag index). NOT called by `clear()` (owners reset side-indices
   *  wholesale there). */
  onEvict?: (key: string, value: V) => void;
}

export class MemoryTtlStore<V> {
  private readonly map = new Map<string, V>();
  private readonly isExpired: (value: V, now: number) => boolean;
  private readonly cleanupIntervalMs: number;
  private readonly maxEntries: number;
  private readonly onEvict?: (key: string, value: V) => void;
  private lastCleanup = 0;

  constructor(options: MemoryTtlStoreOptions<V>) {
    this.isExpired = options.isExpired;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 0;
    this.maxEntries = options.maxEntries ?? 0;
    this.onEvict = options.onEvict;
  }

  /** Lazy cleanup-on-access. No-op when `cleanupIntervalMs <= 0`. */
  maybeCleanup(now: number = Date.now()): void {
    if (this.cleanupIntervalMs <= 0) return;
    if (now - this.lastCleanup >= this.cleanupIntervalMs) {
      this.lastCleanup = now;
      this.cleanup(now);
    }
  }

  /** Get a live (non-expired) value. Expired entries are deleted on read
   *  (firing `onEvict`) and treated as absent. Does NOT call `maybeCleanup`. */
  get(key: string, now: number = Date.now()): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    if (this.isExpired(value, now)) {
      this.delete(key);
      return undefined;
    }
    return value;
  }

  /** Raw stored value, no expiry check (peek). Used by mutate-in-place callers
   *  (rate-limit increment/addTimestamp) that must NOT delete on expiry mid-op. */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  /** True if a live (non-expired) value exists; deletes on expiry-on-read. */
  has(key: string, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  /** Insert/overwrite. When `refreshLruOnOverwrite` is true and the key exists,
   *  the old entry is deleted first (firing `onEvict` for the OLD value) so the
   *  key moves to the newest position (cache's delete-then-reinsert LRU refresh).
   *  Capacity eviction runs BEFORE insert only when the key is new and at/over
   *  `maxEntries`. */
  set(key: string, value: V, refreshLruOnOverwrite = false): void {
    const existed = this.map.has(key);
    if (this.maxEntries > 0 && this.map.size >= this.maxEntries && !existed) {
      this.evictOldest();
    }
    if (existed && refreshLruOnOverwrite) {
      const old = this.map.get(key) as V;
      this.map.delete(key);
      this.onEvict?.(key, old);
    }
    this.map.set(key, value);
  }

  /** Delete a key, firing `onEvict` if present. Returns true if removed. */
  delete(key: string): boolean {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    this.onEvict?.(key, value);
    return true;
  }

  private evictOldest(): void {
    const oldestKey = this.map.keys().next().value;
    if (oldestKey !== undefined) this.delete(oldestKey);
  }

  /** Remove all expired entries. Returns the number removed. */
  cleanup(now: number = Date.now()): number {
    let count = 0;
    const stale: string[] = [];
    for (const [key, value] of this.map.entries()) {
      if (this.isExpired(value, now)) stale.push(key);
    }
    for (const key of stale) {
      if (this.delete(key)) count++;
    }
    return count;
  }

  /** Clear all entries WITHOUT firing `onEvict` (owner resets side-indices). */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  getKeys(): string[] {
    return Array.from(this.map.keys());
  }

  entries(): IterableIterator<[string, V]> {
    return this.map.entries();
  }
}
