import { MemoryCacheStorage, setCacheStorage, withCache } from '@hono-crud/cache';
import { cacheStorageRegistry } from '@hono-crud/cache/mixin';
import { KVCacheStorage } from '@hono-crud/cache/storage/cloudflare-kv';
import { MemoryCreateEndpoint, MemoryReadEndpoint, clearStorage } from '@hono-crud/memory';
import { Hono } from 'hono';
import { fromHono, registerCrud, wrapCacheStorageForOpenApi } from 'hono-crud';
import type { MetaInput, Model } from 'hono-crud';
import type { KVNamespace } from 'hono-crud/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// §4.4 — TTL milliseconds conversion across every cache layer.
//
//   * mixin:   CacheConfig.ttlSeconds (seconds) → CacheStorage.set({ ttlMs })  (×1000)
//   * storage: MemoryCacheStorage.set({ ttlMs: 5000 }) → expiresAt = now + 5000
//   * KV:      set({ ttlMs }) → expirationTtl = max(60, ceil(ttlMs/1000))
//   * openapi: wrapCacheStorageForOpenApi.set(k, v, ttlMs) → { ttlMs } passthrough

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  status: z.enum(['active', 'inactive']).default('active'),
});
type UserItem = z.infer<typeof UserSchema>;
const UserModel: Model<typeof UserSchema> = {
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
};
type UserMeta = MetaInput<typeof UserSchema>;
const userMeta: UserMeta = { model: UserModel };

// ============================================================================
// Mixin: CacheConfig.ttlSeconds (seconds) → storage ttlMs (×1000)
// ============================================================================

describe('§4.4 mixin: CacheConfig.ttlSeconds (seconds) → storage ttlMs', () => {
  class CachedUserRead extends withCache(MemoryReadEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttlSeconds: 300 }; // 300 seconds

    async handle(): Promise<Response> {
      const cached = await this.getCachedResponse<UserItem>();
      if (cached) {
        return this.successWithCache(cached);
      }
      const response = await super.handle();
      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);
        return this.successWithCache(data.result);
      }
      return response;
    }
  }
  class UserCreate extends MemoryCreateEndpoint<any, UserMeta> {
    _meta = userMeta;
  }

  let app: ReturnType<typeof fromHono>;
  let cacheStorage: MemoryCacheStorage;

  beforeEach(() => {
    clearStorage();
    cacheStorage = new MemoryCacheStorage();
    setCacheStorage(cacheStorage);
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      read: CachedUserRead as any,
    });
  });

  afterEach(() => {
    cacheStorage.clear();
    cacheStorageRegistry.reset();
  });

  it('stores expiresAt ≈ now + 300_000 (ttl seconds multiplied by 1000)', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    try {
      const createRes = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
      });
      const { result: user } = await createRes.json();

      // First read populates the cache via the mixin (MISS).
      const missRes = await app.request(`/users/${user.id}`);
      expect(missRes.headers.get('X-Cache')).toBe('MISS');

      // Inspect the single stored entry directly.
      const keys = cacheStorage.getKeys();
      expect(keys).toHaveLength(1);
      const entry = await cacheStorage.get(keys[0]);
      expect(entry).not.toBeNull();
      // 300 seconds → 300_000 ms past the frozen clock. NOT 300 ms.
      expect(entry!.expiresAt).toBe(now + 300_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Storage layer: MemoryCacheStorage.set({ ttlMs }) — milliseconds, not seconds
// ============================================================================

describe('§4.4 MemoryCacheStorage.set({ ttlMs })', () => {
  it('expiresAt equals now + ttlMs (no extra ×1000)', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    try {
      const cache = new MemoryCacheStorage();
      await cache.set('k', 'v', { ttlMs: 5000 });
      const entry = await cache.get('k');
      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBe(now + 5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 5s ttlMs entry expires after 5 seconds, not 5000 seconds', async () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCacheStorage();
      await cache.set('k', 'v', { ttlMs: 5000 });
      vi.advanceTimersByTime(4999);
      expect(await cache.get('k')).not.toBeNull();
      vi.advanceTimersByTime(2);
      expect(await cache.get('k')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('constructor defaultTtlMs is applied in milliseconds', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    try {
      const cache = new MemoryCacheStorage({ defaultTtlMs: 7000 });
      await cache.set('k', 'v'); // no per-entry ttl → uses defaultTtlMs
      const entry = await cache.get('k');
      expect(entry!.expiresAt).toBe(now + 7000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// KV layer: ttlMs → expirationTtl with a 60-second floor
// ============================================================================

interface RecordedPut {
  key: string;
  value: string;
  expirationTtl?: number;
}

function createFakeKv(): { kv: KVNamespace; puts: RecordedPut[] } {
  const puts: RecordedPut[] = [];
  const store = new Map<string, string>();
  const kv: KVNamespace = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, value);
      puts.push({ key, value, expirationTtl: options?.expirationTtl });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true }),
  } as KVNamespace;
  return { kv, puts };
}

describe('§4.4 KVCacheStorage: ttlMs → expirationTtl floor', () => {
  it('floors a sub-60s ttlMs to expirationTtl = 60', async () => {
    const { kv, puts } = createFakeKv();
    const cache = new KVCacheStorage({ kv, prefix: 't:' });

    await cache.set('short', 'v', { ttlMs: 5000 }); // 5s → floored to 60

    const entryPut = puts.find((p) => p.key === 't:short');
    expect(entryPut).toBeDefined();
    expect(entryPut!.expirationTtl).toBe(60);
  });

  it('uses ceil(ttlMs/1000) for TTLs above the floor', async () => {
    const { kv, puts } = createFakeKv();
    const cache = new KVCacheStorage({ kv, prefix: 't:' });

    await cache.set('long', 'v', { ttlMs: 90_500 }); // 90.5s → ceil → 91

    const entryPut = puts.find((p) => p.key === 't:long');
    expect(entryPut!.expirationTtl).toBe(91);
  });
});

// ============================================================================
// OpenAPI adapter: wrapCacheStorageForOpenApi passes { ttlMs } straight through
// ============================================================================

describe('§4.4 wrapCacheStorageForOpenApi ttlMs passthrough', () => {
  it('forwards the ms value as { ttlMs } (no ms→sec conversion)', async () => {
    const calls: Array<{ key: string; options?: { ttlMs?: number } }> = [];
    const inner = {
      async get<T>(_key: string): Promise<{ data: T } | null> {
        return null;
      },
      async set<T>(key: string, _data: T, options?: { ttlMs?: number }): Promise<void> {
        calls.push({ key, options });
      },
    };

    const wrapped = wrapCacheStorageForOpenApi(inner);
    await wrapped.set('doc', { a: 1 }, 5000);

    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('doc');
    expect(calls[0].options).toEqual({ ttlMs: 5000 });
  });

  it('forwards undefined ttl as no options object', async () => {
    const calls: Array<{ options?: { ttlMs?: number } }> = [];
    const inner = {
      async get<T>(_key: string): Promise<{ data: T } | null> {
        return null;
      },
      async set<T>(_key: string, _data: T, options?: { ttlMs?: number }): Promise<void> {
        calls.push({ options });
      },
    };

    const wrapped = wrapCacheStorageForOpenApi(inner);
    await wrapped.set('doc', { a: 1 });

    expect(calls[0].options).toBeUndefined();
  });
});
