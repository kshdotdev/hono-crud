/**
 * KV Cache Storage tests running inside miniflare.
 *
 * Verifies that KVCacheStorage works correctly with real KV bindings
 * in a Cloudflare Workers environment.
 *
 * Run with: vitest --config vitest.config.workers.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { KVCacheStorage } from '../../src/cache/storage/cloudflare-kv';

describe('KVCacheStorage (Workers)', () => {
  let cache: KVCacheStorage;

  beforeEach(async () => {
    cache = new KVCacheStorage({ kv: env.CACHE_KV, prefix: 'test:' });
    await cache.clear();
  });

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', { name: 'test' });
      const entry = await cache.get<{ name: string }>('key1');

      expect(entry).not.toBeNull();
      expect(entry!.data).toEqual({ name: 'test' });
      expect(entry!.createdAt).toBeTypeOf('number');
    });

    it('should return null for non-existent key', async () => {
      const entry = await cache.get('missing');
      expect(entry).toBeNull();
    });

    it('should delete a value', async () => {
      await cache.set('key1', 'value');
      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);

      const entry = await cache.get('key1');
      expect(entry).toBeNull();
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('missing');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value');
      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('missing')).toBe(false);
    });
  });

  describe('TTL', () => {
    it('should support TTL values below the KV expirationTtl minimum with app-level expiry', async () => {
      await cache.set('short-ttl', 'value', { ttl: 1 });
      const entry = await cache.get('short-ttl');

      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBeTypeOf('number');
    });

    it('should store entries with TTL', async () => {
      await cache.set('ttl-key', 'value', { ttl: 60 });
      const entry = await cache.get('ttl-key');

      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBeTypeOf('number');
      expect(entry!.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should use default TTL when none specified', async () => {
      const cache300 = new KVCacheStorage({
        kv: env.CACHE_KV,
        prefix: 'ttl-test:',
        defaultTtl: 300,
      });

      await cache300.set('key1', 'value');
      const entry = await cache300.get('key1');

      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).not.toBeNull();
    });
  });

  describe('tags', () => {
    it('should store entries with tags', async () => {
      await cache.set('user:1', { id: 1 }, { tags: ['users'] });
      await cache.set('user:2', { id: 2 }, { tags: ['users'] });

      const entry = await cache.get<{ id: number }>('user:1');
      expect(entry).not.toBeNull();
      expect(entry!.tags).toEqual(['users']);
    });

    it('should delete entries by tag', async () => {
      await cache.set('user:1', { id: 1 }, { tags: ['users'] });
      await cache.set('user:2', { id: 2 }, { tags: ['users'] });
      await cache.set('post:1', { id: 1 }, { tags: ['posts'] });

      const count = await cache.deleteByTag('users');
      expect(count).toBe(2);

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('post:1')).toBe(true);
    });
  });

  describe('pattern deletion', () => {
    it('should delete entries matching a prefix pattern', async () => {
      await cache.set('user:1', 'a');
      await cache.set('user:2', 'b');
      await cache.set('post:1', 'c');

      const count = await cache.deletePattern('user:*');
      expect(count).toBe(2);

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('post:1')).toBe(true);
    });
  });

  describe('stats', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', 'value');

      await cache.get('key1'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });
});
