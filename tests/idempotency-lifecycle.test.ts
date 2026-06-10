import {
  type IdempotencyEntry,
  type IdempotencyStorage,
  MemoryIdempotencyStorage,
  idempotency,
  setIdempotencyStorage,
} from '@hono-crud/idempotency';
import { idempotencyStorageRegistry } from '@hono-crud/idempotency/middleware';
import { Hono } from 'hono';
import { createStorageMiddleware } from 'hono-crud/storage';
import type { StorageEnv } from 'hono-crud/storage/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// §4.7 / §4.8 — Idempotency lifecycle + config.storage precedence.

beforeEach(() => {
  idempotencyStorageRegistry.reset();
});
afterEach(() => {
  idempotencyStorageRegistry.reset();
});

// ============================================================================
// §4.7 — destroy?() is optional; cleanup() removes expired entries + locks and
// RETURNS the removed count (the old private sweep returned void).
// ============================================================================

describe('§4.7 idempotency storage lifecycle', () => {
  it('a storage without destroy satisfies IdempotencyStorage (destroy is optional)', async () => {
    // This object intentionally omits `destroy`. If `destroy` were still
    // required, this assignment would be a compile error (tsc-checked).
    const noDestroy: IdempotencyStorage = {
      async get() {
        return null;
      },
      async set() {},
      async isLocked() {
        return false;
      },
      async lock() {
        return true;
      },
      async unlock() {},
    };

    expect(noDestroy.destroy).toBeUndefined();
    // The optional cleanup is also absent here and that is valid.
    expect(noDestroy.cleanup).toBeUndefined();
    // Sanity: it behaves like a storage.
    expect(await noDestroy.lock('k', 1000)).toBe(true);
  });

  it('cleanup() removes expired entries and returns the removed count', async () => {
    vi.useFakeTimers();
    try {
      // Disable the lazy maybeCleanup-on-access so cleanup() is the only sweep.
      const storage = new MemoryIdempotencyStorage({ cleanupInterval: 0 });

      const entry = (key: string): IdempotencyEntry => ({
        key,
        statusCode: 200,
        body: '{}',
        headers: {},
        createdAt: Date.now(),
      });

      await storage.set('a', entry('a'), 1000); // expires in 1s
      await storage.set('b', entry('b'), 10_000); // expires in 10s
      await storage.lock('lock-1', 1000); // lock expires in 1s

      // Advance past the 1s TTLs but not the 10s one.
      vi.advanceTimersByTime(2000);

      const removed = await storage.cleanup();
      // 'a' (entry) + 'lock-1' (lock) expired → 2 removed; 'b' survives.
      expect(removed).toBe(2);
      expect(storage.getSize()).toBe(1);
      expect(await storage.isLocked('lock-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanup() returns 0 when nothing is expired', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryIdempotencyStorage({ cleanupInterval: 0 });
      await storage.set(
        'a',
        { key: 'a', statusCode: 200, body: '{}', headers: {}, createdAt: Date.now() },
        10_000,
      );
      expect(await storage.cleanup()).toBe(0);
      expect(storage.getSize()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// §4.8 — config.storage precedence: idempotency({ storage }) uses the explicit
// storage over a context-injected and a global one (single resolution tier via
// resolveIdempotencyStorage(ctx, config.storage); no double-apply).
// ============================================================================

describe('§4.8 idempotency config.storage precedence', () => {
  it('uses config.storage over context-injected and global storage', async () => {
    const explicitStorage = new MemoryIdempotencyStorage();
    const contextStorage = new MemoryIdempotencyStorage();
    const globalStorage = new MemoryIdempotencyStorage();
    setIdempotencyStorage(globalStorage);

    const app = new Hono<StorageEnv>();
    // Inject a DIFFERENT storage into context.
    app.use('/*', createStorageMiddleware({ idempotencyStorage: contextStorage }));
    // config.storage must win over both.
    app.use('/*', idempotency({ storage: explicitStorage }));
    app.post('/op', (c) => c.json({ ok: true }));

    const res = await app.request('/op', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-123' },
    });
    expect(res.status).toBe(200);

    // The response must have been recorded ONLY in the explicit storage.
    // Key is scoped to the (anonymous) user.
    const scopedKey = 'anonymous:key-123';
    expect(await explicitStorage.get(scopedKey)).not.toBeNull();
    expect(await contextStorage.get(scopedKey)).toBeNull();
    expect(await globalStorage.get(scopedKey)).toBeNull();
  });

  it('replays from config.storage on the second request (explicit tier is live)', async () => {
    const explicitStorage = new MemoryIdempotencyStorage();

    let handlerCalls = 0;
    const app = new Hono<StorageEnv>();
    app.use('/*', idempotency({ storage: explicitStorage }));
    app.post('/op', (c) => {
      handlerCalls++;
      return c.json({ count: handlerCalls });
    });

    const headers = { 'Idempotency-Key': 'replay-key' };
    const first = await app.request('/op', { method: 'POST', headers });
    const second = await app.request('/op', { method: 'POST', headers });

    expect(handlerCalls).toBe(1); // second served from the cache
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await first.json()).toEqual({ count: 1 });
    expect(await second.json()).toEqual({ count: 1 });
  });
});
