// Unit tests for the cache entry codec shared by the memory/redis/KV backends.
//
// IMPORT NOTE: `@hono-crud/cache/entry` is internal/alias-only — it is NOT
// published as a package subpath (`@hono-crud/cache` declares only `'.'` in its
// `exports`). These tests reach it through the vitest source alias (the same
// alias-only pattern the other `@hono-crud/cache/storage/*` tests use); the
// import is not a public API surface.
import { buildCacheEntry, isCacheEntryExpired, normalizeStoredEntry } from '@hono-crud/cache/entry';
import type { CacheEntry } from 'hono-crud/internal';
import { describe, expect, it } from 'vitest';

describe('cache entry codec', () => {
  describe('buildCacheEntry', () => {
    it('sets expiresAt = now + ttlMs for positive ttlMs (numbers, no x1000)', () => {
      const now = 1_000_000;
      const entry = buildCacheEntry({ name: 'a' }, 5000, ['t1'], now);

      expect(entry.data).toEqual({ name: 'a' });
      expect(entry.createdAt).toBe(now);
      expect(entry.expiresAt).toBe(now + 5000);
      expect(entry.tags).toEqual(['t1']);
      expect(entry.createdAt).toBeTypeOf('number');
      expect(entry.expiresAt).toBeTypeOf('number');
    });

    it('sets expiresAt = null for ttlMs === 0 ("never expires")', () => {
      const now = 2_000_000;
      const entry = buildCacheEntry('payload', 0, undefined, now);

      expect(entry.createdAt).toBe(now);
      expect(entry.expiresAt).toBeNull();
      expect(entry.tags).toBeUndefined();
    });

    it('sets expiresAt = null for negative ttlMs', () => {
      const entry = buildCacheEntry('payload', -1, undefined, 3_000_000);
      expect(entry.expiresAt).toBeNull();
    });

    it('passes tags through untouched (including undefined)', () => {
      const tags = ['users', 'tenant:1'];
      const withTags = buildCacheEntry(1, 1000, tags, 0);
      expect(withTags.tags).toBe(tags);

      const noTags = buildCacheEntry(1, 1000, undefined, 0);
      expect(noTags.tags).toBeUndefined();
    });

    it('defaults `now` to Date.now() when omitted', () => {
      const before = Date.now();
      const entry = buildCacheEntry('x', 1000, undefined);
      const after = Date.now();

      expect(entry.createdAt).toBeGreaterThanOrEqual(before);
      expect(entry.createdAt).toBeLessThanOrEqual(after);
      expect(entry.expiresAt).toBe(entry.createdAt + 1000);
    });
  });

  describe('normalizeStoredEntry', () => {
    it('migrates legacy ISO-Date-string createdAt/expiresAt to epoch ms', () => {
      const now = Date.now();
      const createdAtIso = new Date(now - 1000).toISOString();
      const expiresAtIso = new Date(now + 60_000).toISOString();

      // Legacy on-wire shape used string dates; launder through unknown to build
      // the fixture without `any`.
      const raw = {
        data: { name: 'legacy' },
        createdAt: createdAtIso,
        expiresAt: expiresAtIso,
        tags: ['t'],
      } as unknown as CacheEntry<{ name: string }>;

      const entry = normalizeStoredEntry(raw);

      expect(entry.createdAt).toBe(Date.parse(createdAtIso));
      expect(entry.expiresAt).toBe(Date.parse(expiresAtIso));
      expect(entry.createdAt).toBeTypeOf('number');
      expect(entry.expiresAt).toBeTypeOf('number');
      expect(entry.data).toEqual({ name: 'legacy' });
    });

    it('falls back createdAt → Date.now() when the legacy string is unparseable', () => {
      const before = Date.now();
      const raw = {
        data: 'x',
        createdAt: 'not-a-date',
        expiresAt: null,
      } as unknown as CacheEntry<string>;

      const entry = normalizeStoredEntry(raw);
      const after = Date.now();

      expect(entry.createdAt).toBeTypeOf('number');
      expect(entry.createdAt).toBeGreaterThanOrEqual(before);
      expect(entry.createdAt).toBeLessThanOrEqual(after);
    });

    it('falls back expiresAt → null when the legacy string is unparseable', () => {
      const raw = {
        data: 'x',
        createdAt: 5_000_000,
        expiresAt: 'garbage',
      } as unknown as CacheEntry<string>;

      const entry = normalizeStoredEntry(raw);

      expect(entry.expiresAt).toBeNull();
      // Numeric createdAt passes through untouched.
      expect(entry.createdAt).toBe(5_000_000);
    });

    it('leaves already-numeric fields untouched', () => {
      const entry: CacheEntry<string> = {
        data: 'x',
        createdAt: 1234,
        expiresAt: 5678,
        tags: undefined,
      };
      const out = normalizeStoredEntry(entry);

      expect(out.createdAt).toBe(1234);
      expect(out.expiresAt).toBe(5678);
    });

    it('leaves a null expiresAt as null', () => {
      const entry: CacheEntry<number> = {
        data: 1,
        createdAt: 1,
        expiresAt: null,
      };
      expect(normalizeStoredEntry(entry).expiresAt).toBeNull();
    });

    it('mutates in place and returns the same object reference', () => {
      const raw = {
        data: 'x',
        createdAt: new Date(0).toISOString(),
        expiresAt: null,
      } as unknown as CacheEntry<string>;

      const out = normalizeStoredEntry(raw);

      expect(out).toBe(raw); // same identity (mutate-in-place)
      expect(raw.createdAt).toBe(0); // the input object itself was mutated
    });
  });

  describe('isCacheEntryExpired', () => {
    const entry = (expiresAt: number | null): CacheEntry<string> => ({
      data: 'x',
      createdAt: 0,
      expiresAt,
    });

    it('returns false when expiresAt is null (never expires)', () => {
      expect(isCacheEntryExpired(entry(null), 1_000_000)).toBe(false);
    });

    it('returns true when expiresAt < now', () => {
      expect(isCacheEntryExpired(entry(1000), 2000)).toBe(true);
    });

    it('returns false when expiresAt === now (boundary, not yet expired)', () => {
      expect(isCacheEntryExpired(entry(1000), 1000)).toBe(false);
    });

    it('returns false when expiresAt > now', () => {
      expect(isCacheEntryExpired(entry(5000), 1000)).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('survives JSON serialize → parse → normalize equal to the numeric entry', () => {
      const now = 1_700_000_000_000;
      const original = buildCacheEntry({ id: 7, name: 'r' }, 30_000, ['a', 'b'], now);

      const wire = JSON.stringify(original);
      const parsed = JSON.parse(wire) as CacheEntry<{ id: number; name: string }>;
      const restored = normalizeStoredEntry(parsed);

      expect(restored).toEqual(original);
      expect(restored.createdAt).toBe(now);
      expect(restored.expiresAt).toBe(now + 30_000);
      // The numeric round-trip must not have been re-interpreted as a string.
      expect(restored.createdAt).toBeTypeOf('number');
      expect(restored.expiresAt).toBeTypeOf('number');
    });

    it('migration runs correctly even when the entry is already expired', () => {
      const now = Date.now();
      const raw = {
        data: 'old',
        createdAt: new Date(now - 120_000).toISOString(),
        expiresAt: new Date(now - 60_000).toISOString(),
      } as unknown as CacheEntry<string>;

      const entry = normalizeStoredEntry(raw);
      expect(entry.expiresAt).toBeTypeOf('number');
      // After migration the standard predicate correctly flags it expired.
      expect(isCacheEntryExpired(entry, now)).toBe(true);
    });
  });
});
