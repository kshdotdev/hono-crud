import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StorageEnv } from '../src/storage/types.js';
import {
  createStorageMiddleware,
  createRateLimitStorageMiddleware,
  createCacheStorageMiddleware,
  resolveRateLimitStorage,
  resolveLoggingStorage,
  resolveCacheStorage,
  resolveAuditStorage,
  resolveVersioningStorage,
  resolveAPIKeyStorage,
} from '../src/storage/index.js';
import { MemoryRateLimitStorage } from '../src/rate-limit/storage/memory.js';
import { MemoryLoggingStorage } from '../src/logging/storage/memory.js';
import { MemoryCacheStorage } from '../src/cache/storage/memory.js';
import { MemoryAuditLogStorage, setAuditStorage } from '../src/audit/index.js';
import { MemoryVersioningStorage, setVersioningStorage } from '../src/versioning/index.js';
import { MemoryAPIKeyStorage } from '../src/auth/storage/memory.js';
import { MemoryIdempotencyStorage } from '../src/idempotency/storage/memory.js';
import { CrudEventEmitter } from '../src/events/emitter.js';
import {
  setRateLimitStorage,
  getRateLimitStorage,
} from '../src/rate-limit/middleware.js';
import {
  setLoggingStorage,
  getLoggingStorage,
} from '../src/logging/middleware.js';
import {
  setCacheStorage,
  getCacheStorage,
} from '../src/cache/mixin.js';
import { setAPIKeyStorage } from '../src/auth/storage/memory.js';

describe('Storage Module', () => {
  describe('createStorageMiddleware', () => {
    it('should inject storage instances into context', async () => {
      const rateLimitStorage = new MemoryRateLimitStorage();
      const loggingStorage = new MemoryLoggingStorage();
      const cacheStorage = new MemoryCacheStorage();
      const auditStorage = new MemoryAuditLogStorage();
      const versioningStorage = new MemoryVersioningStorage();
      const apiKeyStorage = new MemoryAPIKeyStorage();
      const idempotencyStorage = new MemoryIdempotencyStorage();
      const eventEmitter = new CrudEventEmitter();

      const app = new Hono<StorageEnv>();

      app.use(
        '/*',
        createStorageMiddleware({
          rateLimitStorage,
          loggingStorage,
          cacheStorage,
          auditStorage,
          versioningStorage,
          apiKeyStorage,
          idempotencyStorage,
          eventEmitter,
        })
      );

      app.get('/test', (ctx) => {
        // Verify all storage instances are available in context
        expect(ctx.var.rateLimitStorage).toBe(rateLimitStorage);
        expect(ctx.var.loggingStorage).toBe(loggingStorage);
        expect(ctx.var.cacheStorage).toBe(cacheStorage);
        expect(ctx.var.auditStorage).toBe(auditStorage);
        expect(ctx.var.versioningStorage).toBe(versioningStorage);
        expect(ctx.var.apiKeyStorage).toBe(apiKeyStorage);
        expect(ctx.var.idempotencyStorage).toBe(idempotencyStorage);
        expect(ctx.var.eventEmitter).toBe(eventEmitter);
        return ctx.text('ok');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });

    it('should only inject specified storage instances', async () => {
      const rateLimitStorage = new MemoryRateLimitStorage();

      const app = new Hono<StorageEnv>();

      app.use(
        '/*',
        createStorageMiddleware({
          rateLimitStorage,
        })
      );

      app.get('/test', (ctx) => {
        expect(ctx.var.rateLimitStorage).toBe(rateLimitStorage);
        expect(ctx.var.loggingStorage).toBeUndefined();
        expect(ctx.var.cacheStorage).toBeUndefined();
        return ctx.text('ok');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('Individual storage middleware', () => {
    it('createRateLimitStorageMiddleware should inject rate limit storage', async () => {
      const storage = new MemoryRateLimitStorage();
      const app = new Hono<StorageEnv>();

      app.use('/*', createRateLimitStorageMiddleware(storage));

      app.get('/test', (ctx) => {
        expect(ctx.var.rateLimitStorage).toBe(storage);
        return ctx.text('ok');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });

    it('createCacheStorageMiddleware should inject cache storage', async () => {
      const storage = new MemoryCacheStorage();
      const app = new Hono<StorageEnv>();

      app.use('/*', createCacheStorageMiddleware(storage));

      app.get('/test', (ctx) => {
        expect(ctx.var.cacheStorage).toBe(storage);
        return ctx.text('ok');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('Resolve helpers', () => {
    beforeEach(() => {
      // Clear global storage
      setRateLimitStorage(null as unknown as MemoryRateLimitStorage);
      setLoggingStorage(null as unknown as MemoryLoggingStorage);
      setCacheStorage(null as unknown as MemoryCacheStorage);
      setAuditStorage(null as unknown as MemoryAuditLogStorage);
      setVersioningStorage(null as unknown as MemoryVersioningStorage);
      setAPIKeyStorage(null as unknown as MemoryAPIKeyStorage);
    });

    describe('resolveRateLimitStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryRateLimitStorage();
        const result = resolveRateLimitStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should fall back to global storage when no context or explicit', () => {
        const global = new MemoryRateLimitStorage();
        setRateLimitStorage(global);

        const result = resolveRateLimitStorage();
        expect(result).toBe(global);
      });

      it('should return null when no storage configured', () => {
        const result = resolveRateLimitStorage();
        expect(result).toBeNull();
      });

      it('should resolve from context when available', async () => {
        const contextStorage = new MemoryRateLimitStorage();
        const globalStorage = new MemoryRateLimitStorage();
        setRateLimitStorage(globalStorage);

        const app = new Hono<StorageEnv>();
        app.use('/*', createRateLimitStorageMiddleware(contextStorage));

        app.get('/test', (ctx) => {
          const resolved = resolveRateLimitStorage(ctx);
          expect(resolved).toBe(contextStorage);
          expect(resolved).not.toBe(globalStorage);
          return ctx.text('ok');
        });

        await app.request('/test');
      });
    });

    describe('resolveLoggingStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryLoggingStorage();
        const result = resolveLoggingStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should fall back to global storage when no context or explicit', () => {
        const global = new MemoryLoggingStorage();
        setLoggingStorage(global);

        const result = resolveLoggingStorage();
        expect(result).toBe(global);
      });

      it('should return null when no storage configured', () => {
        const result = resolveLoggingStorage();
        expect(result).toBeNull();
      });
    });

    describe('resolveCacheStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryCacheStorage();
        const result = resolveCacheStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should return null when nothing configured', () => {
        const result = resolveCacheStorage();
        expect(result).toBeNull();
      });
    });

    describe('resolveAuditStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryAuditLogStorage();
        const result = resolveAuditStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should return null when nothing configured', () => {
        const result = resolveAuditStorage();
        expect(result).toBeNull();
      });
    });

    describe('resolveVersioningStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryVersioningStorage();
        const result = resolveVersioningStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should return null when nothing configured', () => {
        const result = resolveVersioningStorage();
        expect(result).toBeNull();
      });
    });

    describe('resolveAPIKeyStorage', () => {
      it('should prioritize explicit storage', () => {
        const explicit = new MemoryAPIKeyStorage();
        const result = resolveAPIKeyStorage(undefined, explicit);
        expect(result).toBe(explicit);
      });

      it('should return null when nothing configured', () => {
        const result = resolveAPIKeyStorage();
        expect(result).toBeNull();
      });
    });
  });

  describe('Integration with existing middleware', () => {
    it('rate limit middleware should use context storage when available', async () => {
      const { createRateLimitMiddleware } = await import('../src/rate-limit/middleware.js');

      const contextStorage = new MemoryRateLimitStorage();

      const app = new Hono<StorageEnv>();

      // First inject storage into context
      app.use('/*', createRateLimitStorageMiddleware(contextStorage));

      // Then apply rate limiting (should pick up context storage)
      app.use(
        '/*',
        createRateLimitMiddleware({
          limit: 5,
          windowSeconds: 60,
        })
      );

      app.get('/test', (ctx) => ctx.text('ok'));

      // Make several requests
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }

      // Verify the context storage was used
      const size = contextStorage.getSize();
      expect(size).toBeGreaterThan(0);
    });

    it('logging middleware should use context storage when available', async () => {
      const { createLoggingMiddleware } = await import('../src/logging/middleware.js');
      const { createLoggingStorageMiddleware } = await import('../src/storage/middleware.js');

      const contextStorage = new MemoryLoggingStorage();

      const app = new Hono<StorageEnv>();

      // First inject storage into context
      app.use('/*', createLoggingStorageMiddleware(contextStorage));

      // Then apply logging (should pick up context storage)
      app.use('/*', createLoggingMiddleware());

      app.get('/test', (ctx) => ctx.text('ok'));

      const res = await app.request('/test');
      expect(res.status).toBe(200);

      // Give logging a moment to complete (it's fire-and-forget)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the context storage was used
      const logs = await contextStorage.query({});
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Backward compatibility', () => {
    it('global setRateLimitStorage should still work', async () => {
      const { createRateLimitMiddleware, setRateLimitStorage } = await import(
        '../src/rate-limit/middleware.js'
      );

      const globalStorage = new MemoryRateLimitStorage();
      setRateLimitStorage(globalStorage);

      const app = new Hono();

      app.use(
        '/*',
        createRateLimitMiddleware({
          limit: 10,
          windowSeconds: 60,
        })
      );

      app.get('/test', (ctx) => ctx.text('ok'));

      const res = await app.request('/test');
      expect(res.status).toBe(200);

      // Verify global storage was used
      const size = globalStorage.getSize();
      expect(size).toBeGreaterThan(0);
    });

    it('global setLoggingStorage should still work', async () => {
      const { createLoggingMiddleware, setLoggingStorage } = await import(
        '../src/logging/middleware.js'
      );

      const globalStorage = new MemoryLoggingStorage();
      setLoggingStorage(globalStorage);

      const app = new Hono();

      app.use('/*', createLoggingMiddleware());

      app.get('/test', (ctx) => ctx.text('ok'));

      const res = await app.request('/test');
      expect(res.status).toBe(200);

      // Give logging a moment to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify global storage was used
      const logs = await globalStorage.query({});
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
