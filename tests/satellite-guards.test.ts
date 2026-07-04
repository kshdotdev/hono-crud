/**
 * Regression tests for the satellite type-safety batch: values read back from
 * external storage are validated instead of cast, and wiring holes fail
 * loudly with the canonical envelope error.
 */
import { IdempotencyDurableObject } from '@hono-crud/idempotency';
import { dispatch } from '@hono-crud/mcp/dispatch';
import type { RedisRateLimitClient } from '@hono-crud/rate-limit';
import { RedisRateLimitStorage } from '@hono-crud/rate-limit';
import { isFixedWindowEntry, isSlidingWindowEntry } from '@hono-crud/rate-limit/storage/guards';
import { describe, expect, it } from 'vitest';

// ============================================================================
// rate-limit: entry guards + storage validation (#15/#16)
// ============================================================================

describe('rate-limit entry guards', () => {
  it('validate shapes strictly', () => {
    expect(isFixedWindowEntry({ count: 1, windowStart: 123 })).toBe(true);
    expect(isFixedWindowEntry({ count: '1', windowStart: 123 })).toBe(false);
    expect(isFixedWindowEntry(null)).toBe(false);
    expect(isFixedWindowEntry('{"count":1}')).toBe(false);

    expect(isSlidingWindowEntry({ timestamps: [1, 2, 3] })).toBe(true);
    expect(isSlidingWindowEntry({ timestamps: ['1'] })).toBe(false);
    expect(isSlidingWindowEntry({})).toBe(false);
  });
});

function stubRedis(overrides: Partial<RedisRateLimitClient> = {}): RedisRateLimitClient {
  const stub = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    ...overrides,
  };
  return stub as unknown as RedisRateLimitClient;
}

describe('RedisRateLimitStorage validation', () => {
  it('get() returns null for a malformed/foreign stored value instead of blessing it', async () => {
    const storage = new RedisRateLimitStorage({
      client: stubRedis({ get: async () => JSON.stringify({ hello: 'world' }) }),
    });

    // Previously this returned the garbage object cast as RateLimitEntry.
    expect(await storage.get('key')).toBeNull();
  });

  it('get() still returns a valid fixed-window entry', async () => {
    const entry = { count: 3, windowStart: Date.now() };
    const storage = new RedisRateLimitStorage({
      client: stubRedis({ get: async () => JSON.stringify(entry) }),
    });

    expect(await storage.get('key')).toEqual(entry);
  });

  it('increment() falls through to the non-atomic path when the Lua result is malformed', async () => {
    const sets: unknown[] = [];
    const storage = new RedisRateLimitStorage({
      client: stubRedis({
        eval: async () => JSON.stringify({ nonsense: true }),
        get: async () => null,
        set: async (_key: string, value: string) => {
          sets.push(JSON.parse(value));
        },
      } as Partial<RedisRateLimitClient>),
    });

    const result = await storage.increment('key', 60_000);

    // A well-formed new window entry was produced by the fallback path —
    // the malformed script output was NOT returned as the entry.
    expect(isFixedWindowEntry(result)).toBe(true);
    expect(result.count).toBe(1);
    expect(sets.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// mcp: unknown operation fails loudly (#19)
// ============================================================================

describe('mcp dispatch route table', () => {
  it('unknown operation throws ConfigurationException instead of crashing on destructure', async () => {
    const app = { request: async () => new Response('ok') };

    await expect(
      dispatch(
        app,
        {
          // An operation that can never be in ROUTES (which derives from
          // CRUD_ROUTES minus 'import').
          operation: 'bogusOperation' as never,
          basePath: '/users',
          plan: { hasBody: false, paramKeys: [] } as never,
        },
        {},
      ),
    ).rejects.toMatchObject({
      name: 'ConfigurationException',
      code: 'CONFIGURATION_ERROR',
    });
  });
});

// ============================================================================
// idempotency DO: malformed `set` rejected (#20)
// ============================================================================

function stubDoState() {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    map,
    state: {
      storage: {
        get: async <T>(key: string) => map.get(key) as T | undefined,
        put: async <T>(key: string, value: T) => {
          map.set(key, value);
        },
        delete: async (key: string) => map.delete(key),
        deleteAll: async () => map.clear(),
        getAlarm: async () => alarm,
        setAlarm: async (t: number) => {
          alarm = t;
        },
      },
      blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    },
  };
}

describe('IdempotencyDurableObject set guard', () => {
  it('rejects a set message without an entry and persists nothing', async () => {
    const { map, state } = stubDoState();
    const dobj = new IdempotencyDurableObject(state as never);

    const res = await dobj.fetch(
      new Request('https://do.idempotency/op', {
        method: 'POST',
        body: JSON.stringify({ op: 'set', ttlMs: 1000 }), // no entry
      }),
    );

    expect(await res.json()).toEqual({ error: 'set requires entry' });
    // Previously `entry: undefined` was persisted via the cast.
    expect(map.size).toBe(0);
  });

  it('still accepts a well-formed set', async () => {
    const { map, state } = stubDoState();
    const dobj = new IdempotencyDurableObject(state as never);

    const entry = { status: 200, body: '{}', headers: {}, createdAt: Date.now() };
    const res = await dobj.fetch(
      new Request('https://do.idempotency/op', {
        method: 'POST',
        body: JSON.stringify({ op: 'set', entry, ttlMs: 1000 }),
      }),
    );

    expect(await res.json()).toEqual({ ok: true });
    expect(map.size).toBe(1);
  });
});
