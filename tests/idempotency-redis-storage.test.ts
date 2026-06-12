/**
 * RedisIdempotencyStorage tests (batch B5).
 *
 * Asserts against a mock structural client:
 * 1. Lock acquisition is ONE atomic `SET key value NX PX ttl` round-trip —
 *    no read-then-write two-step (the reason the package ships a Redis
 *    backend and deliberately no Cloudflare KV backend: KV lacks CAS).
 * 2. Lock contention: a second concurrent request with the same key gets the
 *    in-progress 409 conflict.
 * 3. TTL expiry: entries and locks expire via `px` (Redis owns expiry).
 * 4. Completed-response retrieval: the stored entry replays end-to-end.
 */

import {
  type IdempotencyEntry,
  MemoryIdempotencyStorage,
  type RedisIdempotencyClient,
  RedisIdempotencyStorage,
  createIdempotencyMiddleware,
} from '@hono-crud/idempotency';
import { idempotencyStorageRegistry } from '@hono-crud/idempotency/middleware';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Mock Redis client — in-memory map honoring `px` (TTL) and `nx`
// (set-if-absent), with call recording so tests can assert wire semantics.
// ============================================================================

interface SetCall {
  key: string;
  value: string;
  options?: { px?: number; nx?: boolean };
}

class MockRedisClient implements RedisIdempotencyClient {
  store = new Map<string, { value: string; expiresAt: number | null }>();
  setCalls: SetCall[] = [];

  private isExpired(key: string): boolean {
    const item = this.store.get(key);
    if (!item) return true;
    return item.expiresAt !== null && Date.now() >= item.expiresAt;
  }

  private liveGet(key: string): string | null {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return null;
    }
    const item = this.store.get(key);
    return item ? item.value : null;
  }

  async get(key: string): Promise<string | null> {
    return this.liveGet(key);
  }

  async set(key: string, value: string, options?: { px?: number; nx?: boolean }): Promise<unknown> {
    this.setCalls.push({ key, value, options });
    if (options?.nx && this.liveGet(key) !== null) {
      // NX miss — Redis replies with a null bulk string.
      return null;
    }
    this.store.set(key, {
      value,
      expiresAt: options?.px !== undefined ? Date.now() + options.px : null,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    let found = 0;
    for (const key of keys) {
      if (this.liveGet(key) !== null) found++;
    }
    return found;
  }
}

function makeEntry(key: string): IdempotencyEntry {
  return {
    key,
    statusCode: 201,
    body: '{"ok":true}',
    headers: { 'content-type': 'application/json' },
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  idempotencyStorageRegistry.reset();
});
afterEach(() => {
  idempotencyStorageRegistry.reset();
});

// ============================================================================
// Atomic SET NX PX lock semantics
// ============================================================================

describe('RedisIdempotencyStorage lock — atomic SET NX PX', () => {
  it('acquires the lock with exactly ONE set call carrying nx + px', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    const acquired = await storage.lock('user:key-1', 30_000);
    expect(acquired).toBe(true);

    // ONE round-trip, with both NX and PX on the same command — no
    // exists-then-set two-step that another isolate could race through.
    expect(client.setCalls).toHaveLength(1);
    expect(client.setCalls[0]).toEqual({
      key: 'idem:lock:user:key-1',
      value: '1',
      options: { nx: true, px: 30_000 },
    });
  });

  it('returns false on contention (NX miss → null reply), leaving the holder intact', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    expect(await storage.lock('user:key-1', 30_000)).toBe(true);
    // Second concurrent acquire on the same key loses the race.
    expect(await storage.lock('user:key-1', 30_000)).toBe(false);
    // The losing attempt did not clobber the holder's lock value/TTL.
    expect(await storage.isLocked('user:key-1')).toBe(true);
  });

  it('unlock deletes only the lock key (entry/lock keyspaces are segregated)', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    await storage.set('user:key-1', makeEntry('user:key-1'), 60_000);
    await storage.lock('user:key-1', 30_000);
    expect(client.store.has('idem:user:key-1')).toBe(true);
    expect(client.store.has('idem:lock:user:key-1')).toBe(true);

    await storage.unlock('user:key-1');
    expect(await storage.isLocked('user:key-1')).toBe(false);
    // The completed-response entry survives the unlock.
    expect(await storage.get('user:key-1')).not.toBeNull();
  });

  it('honors a custom prefix for both entries and locks', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client, prefix: 'tenant-a:' });

    await storage.set('k', makeEntry('k'), 60_000);
    await storage.lock('k', 30_000);
    expect(client.store.has('tenant-a:k')).toBe(true);
    expect(client.store.has('tenant-a:lock:k')).toBe(true);
  });
});

// ============================================================================
// TTL expiry (px — Redis owns expiry)
// ============================================================================

describe('RedisIdempotencyStorage TTL expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks expire after their px TTL and become acquirable again', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    expect(await storage.lock('k', 1000)).toBe(true);
    expect(await storage.isLocked('k')).toBe(true);

    vi.advanceTimersByTime(1500);

    expect(await storage.isLocked('k')).toBe(false);
    // A crashed holder (lock never released) cannot deadlock the key forever.
    expect(await storage.lock('k', 1000)).toBe(true);
  });

  it('entries expire after their px TTL', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    await storage.set('k', makeEntry('k'), 1000);
    expect(await storage.get('k')).not.toBeNull();

    vi.advanceTimersByTime(1500);
    expect(await storage.get('k')).toBeNull();
  });

  it('a non-positive ttl stores the entry without expiry', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    await storage.set('k', makeEntry('k'), 0);
    expect(client.setCalls[0]?.options).toBeUndefined();

    vi.advanceTimersByTime(1_000_000);
    expect(await storage.get('k')).not.toBeNull();
  });
});

// ============================================================================
// Entry round-trip + corrupted payloads
// ============================================================================

describe('RedisIdempotencyStorage entries', () => {
  it('round-trips an IdempotencyEntry through JSON', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    const entry = makeEntry('user:key-9');
    await storage.set('user:key-9', entry, 60_000);
    expect(await storage.get('user:key-9')).toEqual(entry);
  });

  it('treats a corrupted payload as absent instead of failing the request', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    client.store.set('idem:bad', { value: 'not json {', expiresAt: null });
    expect(await storage.get('bad')).toBeNull();
  });
});

// ============================================================================
// Middleware integration — contention 409 + completed-response replay
// ============================================================================

describe('RedisIdempotencyStorage through createIdempotencyMiddleware', () => {
  function buildApp(storage: RedisIdempotencyStorage, gate?: Promise<void>) {
    let calls = 0;
    const app = new Hono();
    app.use('/*', createIdempotencyMiddleware({ storage }));
    app.post('/op', async (c) => {
      calls++;
      if (gate) await gate;
      return c.json({ calls });
    });
    return { app, callCount: () => calls };
  }

  it('second concurrent request with the same key → 409 IDEMPOTENCY_CONFLICT', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, callCount } = buildApp(storage, gate);

    const headers = { 'Idempotency-Key': 'race-key' };
    // First request acquires the SET NX PX lock and parks in the handler.
    const first = app.request('/op', { method: 'POST', headers });
    // Yield so the first request reaches the gate before the second starts.
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second request finds the lock held → in-progress conflict.
    const second = await app.request('/op', { method: 'POST', headers });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    release();
    expect((await first).status).toBe(200);
    // The handler ran exactly once — the conflicting request never reached it.
    expect(callCount()).toBe(1);
  });

  it('replays the completed response from Redis on retry (handler runs once)', async () => {
    const client = new MockRedisClient();
    const storage = new RedisIdempotencyStorage({ client });
    const { app, callCount } = buildApp(storage);

    const headers = { 'Idempotency-Key': 'replay-key' };
    const first = await app.request('/op', { method: 'POST', headers });
    const second = await app.request('/op', { method: 'POST', headers });

    expect(callCount()).toBe(1);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await first.json()).toEqual({ calls: 1 });
    expect(await second.json()).toEqual({ calls: 1 });
    // The lock was released after completion; only the entry remains.
    expect(await storage.isLocked('anonymous:replay-key')).toBe(false);
  });

  it('shares replay state across storage instances pointing at the same Redis (cross-isolate)', async () => {
    // Two storage instances over ONE client simulate two Workers isolates —
    // exactly the scenario MemoryIdempotencyStorage cannot cover.
    const client = new MockRedisClient();
    const isolateA = new RedisIdempotencyStorage({ client });
    const isolateB = new RedisIdempotencyStorage({ client });

    const appA = buildApp(isolateA);
    const appB = buildApp(isolateB);

    const headers = { 'Idempotency-Key': 'cross-isolate' };
    await appA.app.request('/op', { method: 'POST', headers });
    const replayed = await appB.app.request('/op', { method: 'POST', headers });

    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true');
    expect(appB.callCount()).toBe(0);
  });
});

// ============================================================================
// Contract parity sanity — Redis backend honors the same contract the memory
// backend does (both are IdempotencyStorage implementations).
// ============================================================================

describe('Redis/Memory backend parity', () => {
  it('lock/isLocked/unlock agree across backends', async () => {
    const backends = [
      new RedisIdempotencyStorage({ client: new MockRedisClient() }),
      new MemoryIdempotencyStorage(),
    ];
    for (const backend of backends) {
      expect(await backend.isLocked('p')).toBe(false);
      expect(await backend.lock('p', 30_000)).toBe(true);
      expect(await backend.isLocked('p')).toBe(true);
      expect(await backend.lock('p', 30_000)).toBe(false);
      await backend.unlock('p');
      expect(await backend.isLocked('p')).toBe(false);
    }
  });
});
