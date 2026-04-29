/**
 * KV Rate Limit Storage tests running inside miniflare.
 *
 * Verifies that KVRateLimitStorage works correctly with real KV bindings
 * in a Cloudflare Workers environment.
 *
 * Run with: vitest --config vitest.config.workers.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { KVRateLimitStorage } from '../../src/rate-limit/storage/cloudflare-kv';
import type { KVNamespace } from '../../src/shared/kv-types';

class SameKeyWriteLimitedKV implements KVNamespace {
  private values = new Map<string, string>();
  private writeCounts = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    const writes = this.writeCounts.get(key) ?? 0;
    this.writeCounts.set(key, writes + 1);
    if (writes > 0) {
      throw new Error('KV PUT failed: 429 Too Many Requests');
    }
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(): Promise<{ keys: Array<{ name: string; expiration?: number }>; list_complete: boolean; cursor?: string }> {
    return {
      keys: Array.from(this.values.keys()).map((name) => ({ name })),
      list_complete: true,
    };
  }
}

describe('KVRateLimitStorage (Workers)', () => {
  let storage: KVRateLimitStorage;

  beforeEach(() => {
    storage = new KVRateLimitStorage({ kv: env.RATE_LIMIT_KV, prefix: 'test-rl:' });
  });

  describe('fixed window (increment)', () => {
    it('should support windows shorter than the KV expirationTtl minimum', async () => {
      const entry = await storage.increment('short-window', 1_000);

      expect(entry.count).toBe(1);
      expect(entry.windowStart).toBeTypeOf('number');
    });

    it('should start a new window on first request', async () => {
      const entry = await storage.increment('user:1', 60_000);

      expect(entry.count).toBe(1);
      expect(entry.windowStart).toBeTypeOf('number');
      expect(entry.windowStart).toBeLessThanOrEqual(Date.now());
    });

    it('should increment count within the same window', async () => {
      await storage.increment('user:2', 60_000);
      await storage.increment('user:2', 60_000);
      const entry = await storage.increment('user:2', 60_000);

      expect(entry.count).toBe(3);
    });

    it('should persist entries and retrieve them', async () => {
      await storage.increment('user:3', 60_000);

      const entry = await storage.get('user:3');
      expect(entry).not.toBeNull();
      expect((entry as { count: number }).count).toBe(1);
    });

    it('should fail open on repeated same-key KV write errors by default', async () => {
      const errors: string[] = [];
      const bestEffortStorage = new KVRateLimitStorage({
        kv: new SameKeyWriteLimitedKV(),
        onError: (error) => errors.push(error.message),
      });

      await bestEffortStorage.increment('same-key', 60_000);
      const entry = await bestEffortStorage.increment('same-key', 60_000);

      expect(entry.count).toBe(1);
      expect(errors.some((message) => message.includes('429'))).toBe(true);
    });

    it('should throw same-key KV write errors when failOpen is false', async () => {
      const strictStorage = new KVRateLimitStorage({
        kv: new SameKeyWriteLimitedKV(),
        failOpen: false,
      });

      await strictStorage.increment('strict-key', 60_000);
      await expect(strictStorage.increment('strict-key', 60_000)).rejects.toThrow('429');
    });

    it('should treat malformed stored JSON as a new best-effort window', async () => {
      await env.RATE_LIMIT_KV.put('test-rl:bad-json', '{not-json', { expirationTtl: 60 });

      expect(await storage.get('bad-json')).toBeNull();
      const entry = await storage.increment('bad-json', 60_000);
      expect(entry.count).toBe(1);
    });
  });

  describe('sliding window (addTimestamp)', () => {
    it('should add timestamps within window', async () => {
      const now = Date.now();
      const entry = await storage.addTimestamp('slide:1', 60_000, now);

      expect(entry.timestamps).toHaveLength(1);
      expect(entry.timestamps[0]).toBe(now);
    });

    it('should accumulate timestamps', async () => {
      const now = Date.now();
      await storage.addTimestamp('slide:2', 60_000, now);
      await storage.addTimestamp('slide:2', 60_000, now + 100);
      const entry = await storage.addTimestamp('slide:2', 60_000, now + 200);

      expect(entry.timestamps).toHaveLength(3);
    });

    it('should expire old timestamps outside window', async () => {
      const now = Date.now();
      await storage.addTimestamp('slide:3', 1_000, now - 2_000); // outside window
      const entry = await storage.addTimestamp('slide:3', 1_000, now);

      // Old timestamp should be filtered out
      expect(entry.timestamps).toHaveLength(1);
      expect(entry.timestamps[0]).toBe(now);
    });
  });

  describe('reset', () => {
    it('should remove rate limit entry', async () => {
      await storage.increment('reset:1', 60_000);
      await storage.reset('reset:1');

      const entry = await storage.get('reset:1');
      expect(entry).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should return 0 (KV handles TTL)', async () => {
      const count = await storage.cleanup();
      expect(count).toBe(0);
    });
  });
});
