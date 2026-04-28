/**
 * Edge compatibility tests running inside miniflare.
 *
 * Verifies that core hono-crud modules work within a Workers isolate
 * without leaking Node.js APIs.
 *
 * Run with: vitest --config vitest.config.workers.ts
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import type { StorageEnv } from '../../src/storage/types';

describe('Edge Runtime Compatibility (Workers)', () => {
  describe('Web Crypto API', () => {
    it('should generate UUIDs via crypto.randomUUID()', () => {
      const uuid = crypto.randomUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
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
      const { MemoryCacheStorage } = await import('../../src/cache/storage/memory');

      const cache = new MemoryCacheStorage({ maxSize: 100, defaultTtl: 60 });
      await cache.set('k', { value: 42 });

      const entry = await cache.get<{ value: number }>('k');
      expect(entry).not.toBeNull();
      expect(entry!.data.value).toBe(42);
    });

    it('should work with MemoryRateLimitStorage', async () => {
      const { MemoryRateLimitStorage } = await import('../../src/rate-limit/storage/memory');

      const rl = new MemoryRateLimitStorage();
      const result = await rl.increment('test-key', 60_000);
      expect(result.count).toBe(1);
    });
  });

  describe('Hono app in Workers', () => {
    it('should import the root package entry in a Workers isolate', async () => {
      const mod = await import('../../src/index');
      expect(mod.createCrudMiddleware).toBeTypeOf('function');
      expect(mod.KVCacheStorage).toBeTypeOf('function');
      expect(mod.KVRateLimitStorage).toBeTypeOf('function');
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

  describe('createCrudMiddleware in Workers', () => {
    it('should inject storage into Hono context', async () => {
      const { createCrudMiddleware } = await import('../../src/middleware');
      const { MemoryCacheStorage } = await import('../../src/cache/storage/memory');

      const cache = new MemoryCacheStorage();
      const app = new Hono<StorageEnv>();

      app.use('*', createCrudMiddleware({ cache }));
      app.get('/test', (c) => {
        return c.json({ hasCache: c.var.cacheStorage === cache });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body).toEqual({ hasCache: true });
    });
  });
});
