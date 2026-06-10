import type { CacheEntry } from 'hono-crud/internal';

/**
 * Cache entry codec shared across the memory/redis/KV backends. Centralizes the
 * entry literal, the legacy ISO-Date-string migration, and the expiry guard so
 * all three backends stay byte-for-byte consistent.
 *
 * This module is internal/alias-only — it is NOT published as a package subpath
 * (`@hono-crud/cache` declares only `'.'` in its `exports`). Consumers reach it
 * through the build entrypoint or, in tests, the vitest alias.
 */

/**
 * Build a fresh cache entry. `ttlMs <= 0` means "never expires"
 * (`expiresAt = null`). Byte-equivalent to the literal previously inlined in
 * the memory/redis/KV `set()` methods.
 */
export function buildCacheEntry<T>(
  data: T,
  ttlMs: number,
  tags: string[] | undefined,
  now: number = Date.now(),
): CacheEntry<T> {
  return {
    data,
    createdAt: now,
    expiresAt: ttlMs > 0 ? now + ttlMs : null,
    tags,
  };
}

/**
 * Normalize a parsed/persisted entry IN PLACE: migrate legacy ISO-Date-string
 * `createdAt`/`expiresAt` (pre-PR#56 builds) to epoch ms. Mutates & returns the
 * same object so the caller can run expiry checks afterward. Wire-format compat:
 * redis/KV entries persisted with string dates keep reading. Numeric fields pass
 * through untouched.
 */
export function normalizeStoredEntry<T>(entry: CacheEntry<T>): CacheEntry<T> {
  const legacyCreatedAt = entry.createdAt as unknown;
  if (typeof legacyCreatedAt === 'string') {
    const parsed = Date.parse(legacyCreatedAt);
    entry.createdAt = Number.isNaN(parsed) ? Date.now() : parsed;
  }
  const legacyExpiresAt = entry.expiresAt as unknown;
  if (typeof legacyExpiresAt === 'string') {
    const parsed = Date.parse(legacyExpiresAt);
    entry.expiresAt = Number.isNaN(parsed) ? null : parsed;
  }
  return entry;
}

/**
 * Expiry predicate shared across backends. `null`/falsy `expiresAt` means the
 * entry never expires (load-bearing: `now > expiresAt` would wrongly expire a
 * `null` `expiresAt`). Mirrors the `entry.expiresAt && entry.expiresAt < now`
 * guard used in all three backends.
 */
export function isCacheEntryExpired(entry: CacheEntry<unknown>, now: number = Date.now()): boolean {
  return entry.expiresAt != null && entry.expiresAt < now;
}
