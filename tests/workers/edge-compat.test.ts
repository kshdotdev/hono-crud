import { Hono } from 'hono';
import type { StorageEnv } from 'hono-crud/storage/types';
/**
 * Edge compatibility tests running inside miniflare.
 *
 * Verifies that core hono-crud modules work within a Workers isolate
 * without leaking Node.js APIs.
 *
 * Run with: vitest --config vitest.config.workers.ts
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('Edge Runtime Compatibility (Workers)', () => {
  describe('Web Crypto API', () => {
    it('should generate UUIDs via crypto.randomUUID()', () => {
      const uuid = crypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should have crypto.subtle available', () => {
      expect(crypto.subtle).toBeDefined();
      expect(crypto.subtle.digest).toBeTypeOf('function');
    });

    it('should compute SHA-256 digest', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await crypto.subtle.digest('SHA-256', data);
      expect(hash).toBeInstanceOf(ArrayBuffer);
      expect(hash.byteLength).toBe(32);
    });

    it('should generate random values', () => {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      // Extremely unlikely all zeros
      expect(buf.some((b) => b !== 0)).toBe(true);
    });
  });

  describe('Web Standard APIs', () => {
    it('should have TextEncoder/TextDecoder', () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const encoded = encoder.encode('test');
      expect(decoder.decode(encoded)).toBe('test');
    });

    it('should have ReadableStream', () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk'));
          controller.close();
        },
      });
      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('should have Response and Request', () => {
      const req = new Request('https://example.com');
      const res = new Response('ok', { status: 200 });
      expect(req.url).toBe('https://example.com/');
      expect(res.status).toBe(200);
    });

    it('should have URL and URLSearchParams', () => {
      const url = new URL('https://example.com?a=1&b=2');
      expect(url.searchParams.get('a')).toBe('1');
      expect(url.searchParams.get('b')).toBe('2');
    });
  });

  describe('Memory storage in Worker isolate', () => {
    it('should work with MemoryCacheStorage', async () => {
      // Dynamic import to prove it loads in Workers
      const { MemoryCacheStorage } = await import('@hono-crud/cache/storage/memory');

      const cache = new MemoryCacheStorage({ maxEntries: 100, defaultTtlMs: 60_000 });
      await cache.set('k', { value: 42 });

      const entry = await cache.get<{ value: number }>('k');
      expect(entry).not.toBeNull();
      expect(entry!.data.value).toBe(42);
    });

    it('should work with MemoryRateLimitStorage', async () => {
      const { MemoryRateLimitStorage } = await import('@hono-crud/rate-limit/storage/memory');

      const rl = new MemoryRateLimitStorage();
      const result = await rl.increment('test-key', 60_000);
      expect(result.count).toBe(1);
    });
  });

  describe('Hono app in Workers', () => {
    it('should import the root package entry in a Workers isolate', async () => {
      const mod = await import('hono-crud');
      expect(mod.fromHono).toBeTypeOf('function');
      const { createStorageMiddleware } = await import('hono-crud/storage');
      expect(createStorageMiddleware).toBeTypeOf('function');
      const { KVCacheStorage } = await import('@hono-crud/cache');
      const { KVRateLimitStorage } = await import('@hono-crud/rate-limit');
      expect(KVCacheStorage).toBeTypeOf('function');
      expect(KVRateLimitStorage).toBeTypeOf('function');
    });

    it('should handle requests correctly', async () => {
      const app = new Hono();
      app.get('/ping', (c) => c.json({ pong: true }));

      const res = await app.request('/ping');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ pong: true });
    });

    it('should work with Zod validation', () => {
      const schema = z.object({
        id: z.string().uuid(),
        name: z.string().min(1),
      });

      const result = schema.safeParse({
        id: crypto.randomUUID(),
        name: 'test',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('createStorageMiddleware in Workers', () => {
    it('should inject storage into Hono context', async () => {
      // createStorageMiddleware injects every first-class storage slot
      // (audit/versioning/logging/events plus cache/rate-limit/idempotency)
      // via the CONTEXT_KEYS lookup map.
      const { createStorageMiddleware } = await import('hono-crud/storage');
      const { MemoryAuditLogStorage } = await import('hono-crud/audit');

      const audit = new MemoryAuditLogStorage();
      const app = new Hono<StorageEnv>();

      app.use('*', createStorageMiddleware({ auditStorage: audit }));
      app.get('/test', (c) => {
        return c.json({ hasAudit: c.var.auditStorage === audit });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body).toEqual({ hasAudit: true });
    });
  });
});
