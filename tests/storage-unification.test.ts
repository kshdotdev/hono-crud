import {
  getCacheStorage,
  getCacheStorageRequired,
  resolveCacheStorage,
  setCacheStorage,
} from '@hono-crud/cache/mixin';
import { cacheStorageRegistry } from '@hono-crud/cache/mixin';
import { MemoryCacheStorage } from '@hono-crud/cache/storage/memory';
import {
  getIdempotencyStorage,
  getIdempotencyStorageRequired,
  resolveIdempotencyStorage,
  setIdempotencyStorage,
} from '@hono-crud/idempotency';
import { MemoryIdempotencyStorage } from '@hono-crud/idempotency/storage/memory';
import {
  getRateLimitStorage,
  getRateLimitStorageRequired,
  resolveRateLimitStorage,
  setRateLimitStorage,
} from '@hono-crud/rate-limit/middleware';
import { MemoryRateLimitStorage } from '@hono-crud/rate-limit/storage/memory';
import { Hono } from 'hono';
import {
  MemoryAuditLogStorage,
  auditStorageRegistry,
  getAuditStorage,
  getAuditStorageRequired,
  setAuditStorage,
} from 'hono-crud/audit';
import { MemoryAPIKeyStorage } from 'hono-crud/auth/storage/memory';
import {
  getAPIKeyStorage,
  getAPIKeyStorageRequired,
  setAPIKeyStorage,
} from 'hono-crud/auth/storage/memory';
import { CONTEXT_KEYS } from 'hono-crud/core/context-keys';
import {
  CrudEventEmitter,
  eventEmitterRegistry,
  getEventEmitter,
  resolveEventEmitter,
  setEventEmitter,
} from 'hono-crud/events/emitter';
import {
  getLoggingStorage,
  getLoggingStorageRequired,
  setLoggingStorage,
} from 'hono-crud/logging/middleware';
import { MemoryLoggingStorage } from 'hono-crud/logging/storage/memory';
import { createStorageMiddleware, getStorage } from 'hono-crud/storage';
import type { StorageEnv } from 'hono-crud/storage/types';
import {
  MemoryVersioningStorage,
  getVersioningStorage,
  getVersioningStorageRequired,
  setVersioningStorage,
  versioningStorageRegistry,
} from 'hono-crud/versioning';
import { beforeEach, describe, expect, it } from 'vitest';

// The storage features are module-global. Reset every global slot between tests
// so cross-test leakage can't make a getX()/resolveX() assertion accidentally
// pass against state set by a previous test. Features WITH a defaultFactory
// (audit, versioning, cache, eventEmitter) must reset via `registry.reset()` —
// it clears the `defaultInitialized` flag so the lazy default re-materializes;
// a bare `set(null)` would leave the flag set and break the never-null getters.
function resetGlobalStorage(): void {
  setLoggingStorage(null as unknown as MemoryLoggingStorage);
  setAPIKeyStorage(null as unknown as MemoryAPIKeyStorage);
  setRateLimitStorage(null as unknown as MemoryRateLimitStorage);
  setIdempotencyStorage(null as unknown as MemoryIdempotencyStorage);
  auditStorageRegistry.reset();
  versioningStorageRegistry.reset();
  cacheStorageRegistry.reset();
  eventEmitterRegistry.reset();
}

beforeEach(() => {
  resetGlobalStorage();
});

// ============================================================================
// §4.1 — Context tier is now live for cache / rate-limit / idempotency.
// createStorageMiddleware({ cacheStorage / rateLimitStorage / idempotencyStorage })
// injects the instance and resolveX(ctx) must prefer it over a *different*
// global (priority: context > global). Previously no core middleware wrote
// these slots, so the context tier was dead.
// ============================================================================

describe('§4.1 context-tier now-live (cache / rate-limit / idempotency)', () => {
  it('resolveCacheStorage(ctx) returns the injected instance over a different global', async () => {
    const contextStorage = new MemoryCacheStorage();
    const globalStorage = new MemoryCacheStorage();
    setCacheStorage(globalStorage);

    const app = new Hono<StorageEnv>();
    app.use('/*', createStorageMiddleware({ cacheStorage: contextStorage }));
    app.get('/test', (ctx) => {
      const resolved = resolveCacheStorage(ctx);
      expect(resolved).toBe(contextStorage);
      expect(resolved).not.toBe(globalStorage);
      return ctx.text('ok');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('resolveRateLimitStorage(ctx) returns the injected instance over a different global', async () => {
    const contextStorage = new MemoryRateLimitStorage();
    const globalStorage = new MemoryRateLimitStorage();
    setRateLimitStorage(globalStorage);

    const app = new Hono<StorageEnv>();
    app.use('/*', createStorageMiddleware({ rateLimitStorage: contextStorage }));
    app.get('/test', (ctx) => {
      const resolved = resolveRateLimitStorage(ctx);
      expect(resolved).toBe(contextStorage);
      expect(resolved).not.toBe(globalStorage);
      return ctx.text('ok');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('resolveIdempotencyStorage(ctx) returns the injected instance over an unset global', async () => {
    const contextStorage = new MemoryIdempotencyStorage();

    const app = new Hono<StorageEnv>();
    app.use('/*', createStorageMiddleware({ idempotencyStorage: contextStorage }));
    app.get('/test', (ctx) => {
      const resolved = resolveIdempotencyStorage(ctx);
      expect(resolved).toBe(contextStorage);
      return ctx.text('ok');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// §4.2 — Two-getter contract per feature.
//   getX()         → null when unset and no lazyDefaultOnGet
//   getXRequired() → throws "Storage not configured for '<contextKey>'" when
//                    unset AND no default; returns the lazy default for
//                    audit / versioning; never-null at runtime for cache.
// ============================================================================

describe('§4.2 two-getter contract per feature', () => {
  describe('honest-null getX() when unset (no lazyDefaultOnGet)', () => {
    it('logging getX() returns null; getXRequired() throws', () => {
      expect(getLoggingStorage()).toBeNull();
      expect(() => getLoggingStorageRequired()).toThrow(
        `Storage not configured for '${CONTEXT_KEYS.loggingStorage}'`,
      );
    });

    it('apiKey getX() returns null; getXRequired() throws', () => {
      expect(getAPIKeyStorage()).toBeNull();
      expect(() => getAPIKeyStorageRequired()).toThrow(
        `Storage not configured for '${CONTEXT_KEYS.apiKeyStorage}'`,
      );
    });

    it('rate-limit getX() returns null; getXRequired() throws', () => {
      expect(getRateLimitStorage()).toBeNull();
      expect(() => getRateLimitStorageRequired()).toThrow(
        `Storage not configured for '${CONTEXT_KEYS.rateLimitStorage}'`,
      );
    });

    it('idempotency getX() returns null; getXRequired() throws', () => {
      expect(getIdempotencyStorage()).toBeNull();
      expect(() => getIdempotencyStorageRequired()).toThrow(
        `Storage not configured for '${CONTEXT_KEYS.idempotencyStorage}'`,
      );
    });
  });

  describe('audit / versioning: getX() honest-null, getXRequired() lazy default', () => {
    it('audit getX() is null when unset but getXRequired() materializes a default', () => {
      expect(getAuditStorage()).toBeNull();
      const required = getAuditStorageRequired();
      expect(required).toBeInstanceOf(MemoryAuditLogStorage);
      // After the lazy default materializes, getX() still reports the configured
      // global (which is now the default) — it does not re-null.
      expect(getAuditStorage()).toBe(required);
    });

    it('versioning getX() is null when unset but getXRequired() materializes a default', () => {
      expect(getVersioningStorage()).toBeNull();
      const required = getVersioningStorageRequired();
      expect(required).toBeInstanceOf(MemoryVersioningStorage);
      expect(getVersioningStorage()).toBe(required);
    });

    it('audit getX() returns the explicit instance once set (no default leak)', () => {
      const explicit = new MemoryAuditLogStorage();
      setAuditStorage(explicit);
      expect(getAuditStorage()).toBe(explicit);
      expect(getAuditStorageRequired()).toBe(explicit);
    });
  });

  describe('cache: type-nullable but runtime never-null (lazyDefaultOnGet)', () => {
    it('getCacheStorage() AND getCacheStorageRequired() both return the default at runtime', () => {
      const viaGet = getCacheStorage();
      const viaRequired = getCacheStorageRequired();
      expect(viaGet).toBeInstanceOf(MemoryCacheStorage);
      expect(viaRequired).toBeInstanceOf(MemoryCacheStorage);
      // Same lazily-created instance.
      expect(viaGet).toBe(viaRequired);
    });

    it('getCacheStorage() returns the explicit instance once set', () => {
      const explicit = new MemoryCacheStorage();
      setCacheStorage(explicit);
      expect(getCacheStorage()).toBe(explicit);
      expect(getCacheStorageRequired()).toBe(explicit);
    });
  });

  describe('eventEmitter: never-null (documented exception)', () => {
    it('getEventEmitter() returns a usable bus even when unset', () => {
      const emitter = getEventEmitter();
      expect(emitter).toBeInstanceOf(CrudEventEmitter);
    });
  });
});

// ============================================================================
// §4.5 — createCrudMiddleware is deleted; createStorageMiddleware is the single
// injection factory and the STORAGE_SLOTS lookup map writes EXACTLY the eight
// slots, each readable via getStorage(ctx, key).
// ============================================================================

describe('§4.5 deleted createCrudMiddleware / unified createStorageMiddleware', () => {
  it('createCrudMiddleware is no longer exported from hono-crud', async () => {
    const mod = (await import('hono-crud')) as Record<string, unknown>;
    expect(mod.createCrudMiddleware).toBeUndefined();
    // The replacement is present.
    expect(typeof mod.createStorageMiddleware).toBe('function');
  });

  it('createStorageMiddleware injects all eight slots, readable via getStorage()', async () => {
    const loggingStorage = new MemoryLoggingStorage();
    const auditStorage = new MemoryAuditLogStorage();
    const versioningStorage = new MemoryVersioningStorage();
    const apiKeyStorage = new MemoryAPIKeyStorage();
    const cacheStorage = new MemoryCacheStorage();
    const rateLimitStorage = new MemoryRateLimitStorage();
    const idempotencyStorage = new MemoryIdempotencyStorage();
    const eventEmitter = new CrudEventEmitter();

    const app = new Hono<StorageEnv>();
    app.use(
      '/*',
      createStorageMiddleware({
        loggingStorage,
        auditStorage,
        versioningStorage,
        apiKeyStorage,
        cacheStorage,
        rateLimitStorage,
        idempotencyStorage,
        eventEmitter,
      }),
    );

    app.get('/test', (ctx) => {
      // Read each of the eight slots back through the typed accessor.
      expect(getStorage(ctx, 'loggingStorage')).toBe(loggingStorage);
      expect(getStorage(ctx, 'auditStorage')).toBe(auditStorage);
      expect(getStorage(ctx, 'versioningStorage')).toBe(versioningStorage);
      expect(getStorage(ctx, 'apiKeyStorage')).toBe(apiKeyStorage);
      expect(getStorage(ctx, 'cacheStorage')).toBe(cacheStorage);
      expect(getStorage(ctx, 'rateLimitStorage')).toBe(rateLimitStorage);
      expect(getStorage(ctx, 'idempotencyStorage')).toBe(idempotencyStorage);
      expect(getStorage(ctx, 'eventEmitter')).toBe(eventEmitter);
      return ctx.text('ok');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('writes EXACTLY the eight known slots and nothing else', async () => {
    const app = new Hono<StorageEnv>();
    app.use(
      '/*',
      createStorageMiddleware({
        cacheStorage: new MemoryCacheStorage(),
      }),
    );

    let writtenKeys: string[] = [];
    app.get('/test', (ctx) => {
      // Only keys the middleware actually wrote should be defined; unprovided
      // slots stay undefined (selective injection).
      const slots = [
        'loggingStorage',
        'auditStorage',
        'versioningStorage',
        'apiKeyStorage',
        'cacheStorage',
        'rateLimitStorage',
        'idempotencyStorage',
        'eventEmitter',
      ] as const;
      writtenKeys = slots.filter((k) => getStorage(ctx, k) !== undefined);
      return ctx.text('ok');
    });

    await app.request('/test');
    expect(writtenKeys).toEqual(['cacheStorage']);
  });
});

// ============================================================================
// §4.9 — eventEmitter parity: injected via createStorageMiddleware, resolved
// via resolveEventEmitter(ctx); getEventEmitter() never null.
// ============================================================================

describe('§4.9 eventEmitter parity', () => {
  it('resolveEventEmitter(ctx) returns the injected emitter over a different global', async () => {
    const contextEmitter = new CrudEventEmitter();
    const globalEmitter = new CrudEventEmitter();
    setEventEmitter(globalEmitter);

    const app = new Hono<StorageEnv>();
    app.use('/*', createStorageMiddleware({ eventEmitter: contextEmitter }));
    app.get('/test', (ctx) => {
      const resolved = resolveEventEmitter(ctx);
      expect(resolved).toBe(contextEmitter);
      expect(resolved).not.toBe(globalEmitter);
      return ctx.text('ok');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('getEventEmitter() is never null even with no global configured', () => {
    expect(getEventEmitter()).toBeInstanceOf(CrudEventEmitter);
  });
});
