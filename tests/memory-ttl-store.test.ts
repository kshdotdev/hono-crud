import type { MemoryTtlStoreOptions } from 'hono-crud/internal';
import { MemoryTtlStore } from 'hono-crud/internal';
import { describe, expect, it, vi } from 'vitest';

// Unit tests for the generic TTL Map store composed by the in-memory cache,
// rate-limit, and idempotency backends. The store is synchronous and accepts an
// explicit `now` argument on every time-sensitive method, so the tests drive
// the clock through that argument instead of fake timers (the same `now`-arg
// approach the spec's TEST PLAN calls out).

// A simple value-with-expiry wrapper exercises the `isExpired(value, now)`
// predicate the way the rate-limit/idempotency owners use it.
interface Wrapper {
  payload: string;
  expiresAt: number;
}

const expiresByField = (value: Wrapper, now: number): boolean => now > value.expiresAt;

function makeStore(
  overrides: Partial<MemoryTtlStoreOptions<Wrapper>> = {},
): MemoryTtlStore<Wrapper> {
  return new MemoryTtlStore<Wrapper>({ isExpired: expiresByField, ...overrides });
}

const wrap = (payload: string, expiresAt = Number.POSITIVE_INFINITY): Wrapper => ({
  payload,
  expiresAt,
});

describe('MemoryTtlStore', () => {
  describe('capacity eviction', () => {
    it('evicts the oldest (first-inserted) entry when at maxEntries', () => {
      const store = makeStore({ maxEntries: 2 });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2'));
      store.set('key3', wrap('v3')); // at capacity → evict key1 (oldest)

      expect(store.getKeys()).toEqual(['key2', 'key3']);
      expect(store.size).toBe(2);
      expect(store.get('key1')).toBeUndefined();
    });

    it('does not evict when overwriting an existing key at capacity', () => {
      const store = makeStore({ maxEntries: 2 });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2'));
      // Overwriting an existing key must not trip capacity eviction.
      store.set('key1', wrap('v1-updated'));

      expect(store.getKeys()).toEqual(['key1', 'key2']);
      expect(store.get('key1')?.payload).toBe('v1-updated');
    });

    it('maxEntries <= 0 disables capacity eviction', () => {
      const store = makeStore({ maxEntries: 0 });
      for (let i = 0; i < 5; i++) store.set(`key${i}`, wrap(`v${i}`));
      expect(store.size).toBe(5);
      expect(store.getKeys()).toEqual(['key0', 'key1', 'key2', 'key3', 'key4']);
    });
  });

  describe('refreshLruOnOverwrite', () => {
    it('moves an overwritten key to the newest position when refresh=true', () => {
      const store = makeStore({ maxEntries: 2 });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2'));
      // Refresh key1 → it becomes the newest, so key2 is now the oldest.
      store.set('key1', wrap('v1-refreshed'), /* refreshLruOnOverwrite */ true);
      store.set('key3', wrap('v3')); // capacity → evict key2 (now oldest)

      expect(store.getKeys()).toEqual(['key1', 'key3']);
      expect(store.get('key1')?.payload).toBe('v1-refreshed');
      expect(store.get('key2')).toBeUndefined();
    });

    it('does NOT change insertion order when refresh=false (default)', () => {
      const store = makeStore({ maxEntries: 2 });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2'));
      // Overwrite without refresh → key1 stays oldest.
      store.set('key1', wrap('v1-updated'), /* refreshLruOnOverwrite */ false);
      store.set('key3', wrap('v3')); // capacity → evict key1 (still oldest)

      expect(store.getKeys()).toEqual(['key2', 'key3']);
      expect(store.get('key1')).toBeUndefined();
    });
  });

  describe('onEvict hook', () => {
    it('fires on capacity eviction', () => {
      const onEvict = vi.fn();
      const store = makeStore({ maxEntries: 1, onEvict });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2')); // evicts key1

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', expect.objectContaining({ payload: 'v1' }));
    });

    it('fires on expiry-on-read via get()', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('key1', wrap('v1', 1000));
      expect(store.get('key1', 2000)).toBeUndefined(); // expired at now=2000

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', expect.objectContaining({ payload: 'v1' }));
    });

    it('fires once per swept entry on cleanup()', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('a', wrap('a', 1000));
      store.set('b', wrap('b', 5000));
      store.set('c', wrap('c', 1000));

      const removed = store.cleanup(2000); // a, c expired; b survives

      expect(removed).toBe(2);
      expect(onEvict).toHaveBeenCalledTimes(2);
      expect(onEvict.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c']);
    });

    it('fires on delete()', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('key1', wrap('v1'));
      expect(store.delete('key1')).toBe(true);

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', expect.objectContaining({ payload: 'v1' }));
    });

    it('fires with the OLD value on refresh-overwrite', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('key1', wrap('old'));
      store.set('key1', wrap('new'), /* refreshLruOnOverwrite */ true);

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', expect.objectContaining({ payload: 'old' }));
      expect(store.get('key1')?.payload).toBe('new');
    });

    it('does NOT fire on clear()', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('key1', wrap('v1'));
      store.set('key2', wrap('v2'));
      store.clear();

      expect(onEvict).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('does NOT fire delete() for a missing key', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      expect(store.delete('absent')).toBe(false);
      expect(onEvict).not.toHaveBeenCalled();
    });
  });

  describe('peek', () => {
    it('returns the raw value without an expiry check or delete', () => {
      const onEvict = vi.fn();
      const store = makeStore({ onEvict });

      store.set('key1', wrap('v1', 1000));

      // peek must not delete the entry even though it is "expired" relative to a
      // later clock — it never runs isExpired.
      const peeked = store.peek('key1');
      expect(peeked?.payload).toBe('v1');
      expect(store.size).toBe(1);
      expect(onEvict).not.toHaveBeenCalled();

      // get() at the same clock WOULD delete it — contrast with peek.
      expect(store.get('key1', 2000)).toBeUndefined();
      expect(store.size).toBe(0);
    });

    it('returns undefined for a missing key', () => {
      const store = makeStore();
      expect(store.peek('absent')).toBeUndefined();
    });
  });

  describe('cleanup()', () => {
    it('returns the exact removed count and leaves survivors', () => {
      const store = makeStore();
      store.set('a', wrap('a', 1000));
      store.set('b', wrap('b', 2000));
      store.set('c', wrap('c', 3000));
      store.set('d', wrap('d')); // never expires (Infinity)

      const removed = store.cleanup(2500); // a, b expired

      expect(removed).toBe(2);
      expect(store.size).toBe(2);
      expect(store.getKeys()).toEqual(['c', 'd']);
    });

    it('returns 0 when nothing is expired', () => {
      const store = makeStore();
      store.set('a', wrap('a', 10_000));
      expect(store.cleanup(5000)).toBe(0);
      expect(store.size).toBe(1);
    });
  });

  describe('maybeCleanup (lazy cleanup-on-access guard)', () => {
    it('never sweeps when cleanupInterval <= 0', () => {
      const onEvict = vi.fn();
      const store = makeStore({ cleanupInterval: 0, onEvict });

      store.set('a', wrap('a', 1000));
      // Even far past expiry, the lazy guard is disabled.
      store.maybeCleanup(1_000_000);

      expect(store.size).toBe(1);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('sweeps at most once per interval window', () => {
      const store = makeStore({ cleanupInterval: 1000 });

      store.set('a', wrap('a', 500));
      store.set('b', wrap('b', 5000));

      // First call past the interval since lastCleanup(=0): sweeps, removes 'a'.
      store.maybeCleanup(1000);
      expect(store.size).toBe(1);
      expect(store.getKeys()).toEqual(['b']);

      // Add another already-expired entry; a call inside the same window does
      // NOT sweep again.
      store.set('c', wrap('c', 100));
      store.maybeCleanup(1500); // 1500 - 1000 < 1000 → no sweep
      expect(store.getKeys()).toEqual(['b', 'c']);

      // Once the next window opens, it sweeps again and removes 'c'.
      store.maybeCleanup(2000); // 2000 - 1000 >= 1000 → sweep
      expect(store.getKeys()).toEqual(['b']);
    });
  });

  describe('expiry-on-read', () => {
    it('get() returns undefined for an expired entry AND deletes it', () => {
      const store = makeStore();
      store.set('key1', wrap('v1', 1000));

      expect(store.get('key1', 500)).toEqual(expect.objectContaining({ payload: 'v1' }));
      expect(store.get('key1', 2000)).toBeUndefined(); // expired → deleted
      expect(store.size).toBe(0);
      // Subsequent peek confirms the entry is gone.
      expect(store.peek('key1')).toBeUndefined();
    });

    it('has() returns false for an expired entry AND deletes it', () => {
      const store = makeStore();
      store.set('key1', wrap('v1', 1000));

      expect(store.has('key1', 500)).toBe(true);
      expect(store.has('key1', 2000)).toBe(false); // expired → deleted
      expect(store.size).toBe(0);
    });

    it('get() returns undefined for a missing key', () => {
      const store = makeStore();
      expect(store.get('absent')).toBeUndefined();
    });
  });

  describe('debug accessors', () => {
    it('size, getKeys, and entries reflect live contents', () => {
      const store = makeStore();
      store.set('a', wrap('a'));
      store.set('b', wrap('b'));

      expect(store.size).toBe(2);
      expect(store.getKeys()).toEqual(['a', 'b']);
      expect([...store.entries()].map(([k, v]) => [k, v.payload])).toEqual([
        ['a', 'a'],
        ['b', 'b'],
      ]);
    });
  });
});
