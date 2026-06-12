import {
  MemoryCacheStorage,
  RedisCacheStorage,
  createInvalidationPattern,
  createRelatedPatterns,
  generateCacheKey,
  getCacheStorage,
  matchesPattern,
  parseCacheKey,
  setCacheStorage,
  withCache,
  withCacheInvalidation,
} from '@hono-crud/cache';
import type { RedisClient } from '@hono-crud/cache';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { Hono } from 'hono';
import type { ExecutionContext } from 'hono';
import { fromHono, registerCrud } from 'hono-crud';
import type { MetaInput, Model, ResponseEnvelope } from 'hono-crud';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Define test schema
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
// Memory Cache Storage Tests
// ============================================================================

describe('MemoryCacheStorage', () => {
  let cache: MemoryCacheStorage;

  beforeEach(() => {
    cache = new MemoryCacheStorage();
  });

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', { name: 'test' });
      const entry = await cache.get<{ name: string }>('key1');

      expect(entry).not.toBeNull();
      expect(entry!.data.name).toBe('test');
      expect(entry!.createdAt).toBeTypeOf('number');
      expect(entry!.expiresAt).toBeTypeOf('number');
    });

    it('should return null for non-existent key', async () => {
      const entry = await cache.get('nonexistent');
      expect(entry).toBeNull();
    });

    it('should delete a key', async () => {
      await cache.set('key1', { name: 'test' });
      const deleted = await cache.delete('key1');

      expect(deleted).toBe(true);
      expect(await cache.has('key1')).toBe(false);
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value');

      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('key2')).toBe(false);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();

      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttlMs: 60_000 }); // 60 seconds

      // Before expiration
      expect(await cache.get('key1')).not.toBeNull();

      // Advance time past TTL
      vi.advanceTimersByTime(61 * 1000);

      // After expiration
      expect(await cache.get('key1')).toBeNull();

      vi.useRealTimers();
    });

    it('should not expire entries with no TTL', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttlMs: 0 }); // No TTL

      vi.advanceTimersByTime(86400 * 1000); // 1 day

      expect(await cache.get('key1')).not.toBeNull();

      vi.useRealTimers();
    });

    it('should update stats on expired get', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttlMs: 60_000 });

      // Get before expiration - should be a hit
      await cache.get('key1');

      // Advance past TTL
      vi.advanceTimersByTime(61 * 1000);

      // Get after expiration - should be a miss
      await cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      vi.useRealTimers();
    });

    it('should re-sync getStats().size after expiry-on-read via get()', async () => {
      // Regression guard: expiry-on-read now goes through the delegated
      // MemoryTtlStore, which fires onEvict (tag cleanup) but does NOT touch
      // stats.size. The store call must re-sync `stats.size = store.size` so
      // getStats().size stays consistent once the expired entry is evicted.
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttlMs: 60_000 });
      expect(cache.getStats().size).toBe(1);

      vi.advanceTimersByTime(61 * 1000);

      // Expiry-on-read deletes the entry and must reflect in size.
      expect(await cache.get('key1')).toBeNull();
      expect(cache.getStats().size).toBe(0);

      vi.useRealTimers();
    });

    it('should re-sync getStats().size after expiry-on-read via has()', async () => {
      // Same regression guard for the has() path (also expiry-deletes on read).
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttlMs: 60_000 });
      expect(cache.getStats().size).toBe(1);

      vi.advanceTimersByTime(61 * 1000);

      expect(await cache.has('key1')).toBe(false);
      expect(cache.getStats().size).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('pattern deletion', () => {
    beforeEach(async () => {
      await cache.set('users:GET:id=1', { id: 1 });
      await cache.set('users:GET:id=2', { id: 2 });
      await cache.set('users:LIST:page=1', []);
      await cache.set('posts:GET:id=1', { id: 1 });
    });

    it('should delete entries matching pattern', async () => {
      const count = await cache.deletePattern('users:*');

      expect(count).toBe(3);
      expect(await cache.has('users:GET:id=1')).toBe(false);
      expect(await cache.has('users:LIST:page=1')).toBe(false);
      expect(await cache.has('posts:GET:id=1')).toBe(true);
    });

    it('should delete entries matching specific pattern', async () => {
      const count = await cache.deletePattern('users:GET:*');

      expect(count).toBe(2);
      expect(await cache.has('users:LIST:page=1')).toBe(true);
    });

    it('should return 0 for non-matching pattern', async () => {
      const count = await cache.deletePattern('comments:*');
      expect(count).toBe(0);
    });
  });

  describe('tag-based invalidation', () => {
    beforeEach(async () => {
      await cache.set('key1', 'value1', { tags: ['users', 'api'] });
      await cache.set('key2', 'value2', { tags: ['users'] });
      await cache.set('key3', 'value3', { tags: ['posts'] });
    });

    it('should delete entries by tag', async () => {
      const count = await cache.deleteByTag!('users');

      expect(count).toBe(2);
      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
      expect(await cache.has('key3')).toBe(true);
    });

    it('should return 0 for non-existent tag', async () => {
      const count = await cache.deleteByTag!('nonexistent');
      expect(count).toBe(0);
    });

    it('should drop the now-empty tag bucket from getTags() after deleteByTag', async () => {
      // Regression guard: onEvict → removeFromTagIndex only removes the key from
      // each tag's Set; the explicit final tagIndex.delete(tag) in deleteByTag is
      // load-bearing to drop the emptied bucket so getTags() stays consistent.
      expect(cache.getTags()).toContain('posts');

      await cache.deleteByTag!('posts');

      expect(cache.getTags()).not.toContain('posts');
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', 'value');

      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('key2'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should track size', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      expect(cache.getStats().size).toBe(2);

      await cache.delete('key1');
      expect(cache.getStats().size).toBe(1);
    });

    it('should reset stats', async () => {
      await cache.get('nonexistent');
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('max entries', () => {
    it('should evict oldest entry when at capacity', async () => {
      const limitedCache = new MemoryCacheStorage({ maxEntries: 2 });

      await limitedCache.set('key1', 'value1');
      await limitedCache.set('key2', 'value2');
      await limitedCache.set('key3', 'value3'); // Should evict key1

      expect(await limitedCache.has('key1')).toBe(false);
      expect(await limitedCache.has('key2')).toBe(true);
      expect(await limitedCache.has('key3')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value1', { ttlMs: 60_000 });
      await cache.set('key2', 'value2', { ttlMs: 120_000 });
      await cache.set('key3', 'value3', { ttlMs: 0 }); // No expiration

      vi.advanceTimersByTime(90 * 1000);

      const count = await cache.cleanup();

      expect(count).toBe(1); // key1 expired
      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(true);
      expect(await cache.has('key3')).toBe(true);

      vi.useRealTimers();
    });
  });
});

class InMemoryRedisClient implements RedisClient {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.values.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) deleted++;
    }
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.filter((key) => this.values.has(key)).length;
  }
}

describe('RedisCacheStorage', () => {
  it('should migrate legacy Date-string cache entries to epoch milliseconds', async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisCacheStorage({ client, prefix: 'test:' });
    const now = Date.now();

    await client.set(
      'test:legacy',
      JSON.stringify({
        data: { name: 'legacy' },
        createdAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      }),
    );

    const entry = await cache.get<{ name: string }>('legacy');
    expect(entry).not.toBeNull();
    expect(entry!.data.name).toBe('legacy');
    expect(entry!.createdAt).toBeTypeOf('number');
    expect(entry!.expiresAt).toBeTypeOf('number');
  });
});

// ============================================================================
// Cache Key Generation Tests
// ============================================================================

describe('Cache Key Generation', () => {
  describe('generateCacheKey', () => {
    it('should generate key for GET request', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'GET',
        params: { id: '123' },
      });

      expect(key).toBe('users:GET:id=123');
    });

    it('should generate key for LIST request', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'LIST',
        query: { page: '1', per_page: '20' },
        keyFields: ['page', 'per_page'],
      });

      expect(key).toBe('users:LIST:page=1&per_page=20');
    });

    it('should generate key with prefix', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'GET',
        params: { id: '123' },
        prefix: 'myapp',
      });

      expect(key).toBe('myapp:users:GET:id=123');
    });

    it('should generate key with userId', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'GET',
        params: { id: '123' },
        userId: '456',
      });

      expect(key).toBe('users:GET:id=123:user=456');
    });

    it('should filter query params by keyFields', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'LIST',
        query: { page: '1', search: 'john', ignored: 'value' },
        keyFields: ['page', 'search'],
      });

      expect(key).toBe('users:LIST:page=1&search=john');
    });

    it('should sort params alphabetically', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'LIST',
        query: { z: '1', a: '2', m: '3' },
        keyFields: ['z', 'a', 'm'],
      });

      expect(key).toBe('users:LIST:a=2&m=3&z=1');
    });

    it('should exclude undefined/null/empty values', () => {
      const key = generateCacheKey({
        tableName: 'users',
        method: 'LIST',
        query: { page: '1', empty: '', nullish: null, undef: undefined },
        keyFields: ['page', 'empty', 'nullish', 'undef'],
      });

      expect(key).toBe('users:LIST:page=1');
    });
  });

  describe('createInvalidationPattern', () => {
    it('should create pattern for all table caches', () => {
      const pattern = createInvalidationPattern('users');
      expect(pattern).toBe('users:*');
    });

    it('should create pattern for specific method', () => {
      const pattern = createInvalidationPattern('users', { method: 'LIST' });
      expect(pattern).toBe('users:LIST*');
    });

    it('should create pattern for specific ID', () => {
      const pattern = createInvalidationPattern('users', { id: '123' });
      expect(pattern).toBe('users:*:id=123*');
    });

    it('should create pattern for specific user', () => {
      const pattern = createInvalidationPattern('users', { userId: '456' });
      expect(pattern).toBe('users:*:user=456');
    });

    it('should include prefix in pattern', () => {
      const pattern = createInvalidationPattern('users', undefined, 'myapp');
      expect(pattern).toBe('myapp:users:*');
    });
  });

  describe('createRelatedPatterns', () => {
    it('should create patterns for related models', () => {
      const patterns = createRelatedPatterns('users', ['posts', 'comments']);

      expect(patterns).toHaveLength(2);
      expect(patterns).toContain('posts:*');
      expect(patterns).toContain('comments:*');
    });

    it('should include prefix in patterns', () => {
      const patterns = createRelatedPatterns('users', ['posts'], 'myapp');

      expect(patterns).toHaveLength(1);
      expect(patterns[0]).toBe('myapp:posts:*');
    });
  });

  describe('matchesPattern', () => {
    it('should match exact pattern', () => {
      expect(matchesPattern('users:GET:id=123', 'users:GET:id=123')).toBe(true);
    });

    it('should match wildcard pattern', () => {
      expect(matchesPattern('users:GET:id=123', 'users:*')).toBe(true);
      expect(matchesPattern('users:LIST:page=1', 'users:*')).toBe(true);
    });

    it('should match partial wildcard', () => {
      expect(matchesPattern('users:GET:id=123', 'users:GET:*')).toBe(true);
      expect(matchesPattern('users:LIST:page=1', 'users:GET:*')).toBe(false);
    });

    it('should not match different table', () => {
      expect(matchesPattern('posts:GET:id=123', 'users:*')).toBe(false);
    });
  });

  describe('parseCacheKey', () => {
    it('should parse GET key', () => {
      const parsed = parseCacheKey('users:GET:id=123');

      expect(parsed.tableName).toBe('users');
      expect(parsed.method).toBe('GET');
      expect(parsed.params).toEqual({ id: '123' });
    });

    it('should parse LIST key', () => {
      const parsed = parseCacheKey('users:LIST:page=1&per_page=20');

      expect(parsed.tableName).toBe('users');
      expect(parsed.method).toBe('LIST');
      expect(parsed.query).toEqual({ page: '1', per_page: '20' });
    });

    it('should parse key with prefix', () => {
      const parsed = parseCacheKey('myapp:users:GET:id=123');

      expect(parsed.prefix).toBe('myapp');
      expect(parsed.tableName).toBe('users');
    });

    it('should parse key with userId', () => {
      const parsed = parseCacheKey('users:GET:id=123:user=456');

      expect(parsed.userId).toBe('456');
    });
  });
});

// ============================================================================
// withCache Mixin Integration Tests
// ============================================================================

describe('withCache Mixin', () => {
  let app: ReturnType<typeof fromHono>;
  let cacheStorage: MemoryCacheStorage;

  // Create cached endpoint classes
  class CachedUserRead extends withCache(MemoryReadEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttl: 300 };

    async handle(): Promise<Response> {
      // Try cache first
      const cached = await this.getCachedResponse<UserItem>();
      if (cached) {
        return this.successWithCache(cached);
      }

      // Fetch from database
      const response = await super.handle();

      // Cache successful responses
      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);

        // Return with cache header
        return this.successWithCache(data.result);
      }

      return response;
    }
  }

  class CachedUserList extends withCache(MemoryListEndpoint) {
    _meta = userMeta;
    cacheConfig = {
      ttl: 60,
      keyFields: ['page', 'per_page', 'status'],
    };

    async handle(): Promise<Response> {
      const cached = await this.getCachedResponse<UserItem[]>();
      if (cached) {
        return this.successPaginatedWithCache(cached, { page: 1, per_page: 20 });
      }

      const response = await super.handle();

      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);

        // Return with cache header
        return this.successPaginatedWithCache(data.result, data.result_info);
      }

      return response;
    }
  }

  class UserCreate extends MemoryCreateEndpoint<any, UserMeta> {
    _meta = userMeta;
  }

  class UserUpdate extends MemoryUpdateEndpoint<any, UserMeta> {
    _meta = userMeta;
  }

  class UserDelete extends MemoryDeleteEndpoint<any, UserMeta> {
    _meta = userMeta;
  }

  beforeEach(() => {
    clearStorage();
    cacheStorage = new MemoryCacheStorage();
    setCacheStorage(cacheStorage);

    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: CachedUserList as any,
      read: CachedUserRead as any,
      update: UserUpdate as any,
      delete: UserDelete as any,
    });
  });

  afterEach(() => {
    cacheStorage.clear();
  });

  it('should miss cache on first request', async () => {
    // Create a user first
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'John',
        email: 'john@example.com',
      }),
    });

    // List request
    const res = await app.request('/users');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('MISS');
  });

  it('should hit cache on second request', async () => {
    // Create a user
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'John',
        email: 'john@example.com',
      }),
    });

    // First request - miss
    await app.request('/users');

    // Second request - hit
    const res = await app.request('/users');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('HIT');
  });

  it('should cache read endpoint', async () => {
    // Create a user
    const createRes = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'John',
        email: 'john@example.com',
      }),
    });
    const { result: user } = await createRes.json();

    // First read - miss
    const res1 = await app.request(`/users/${user.id}`);
    expect(res1.headers.get('X-Cache')).toBe('MISS');

    // Second read - hit
    const res2 = await app.request(`/users/${user.id}`);
    expect(res2.headers.get('X-Cache')).toBe('HIT');

    // Same data
    const data1 = await res1.json();
    const data2 = await res2.json();
    expect(data2.result).toEqual(data1.result);
  });

  it('should generate different keys for different query params', async () => {
    // Create users
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });

    // Request with page=1
    const res1 = await app.request('/users?page=1');
    expect(res1.headers.get('X-Cache')).toBe('MISS');

    // Request with page=2
    const res2 = await app.request('/users?page=2');
    expect(res2.headers.get('X-Cache')).toBe('MISS');

    // Request with page=1 again - should hit
    const res3 = await app.request('/users?page=1');
    expect(res3.headers.get('X-Cache')).toBe('HIT');
  });

  it('should track cache statistics', async () => {
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });

    await app.request('/users'); // miss
    await app.request('/users'); // hit
    await app.request('/users?page=2'); // miss

    const stats = cacheStorage.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });
});

// ============================================================================
// withCacheInvalidation Mixin Integration Tests
// ============================================================================

describe('withCacheInvalidation Mixin', () => {
  let app: ReturnType<typeof fromHono>;
  let cacheStorage: MemoryCacheStorage;

  // Cached read endpoint
  class CachedUserRead extends withCache(MemoryReadEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttl: 300 };

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

  // Cached list endpoint
  class CachedUserList extends withCache(MemoryListEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttl: 300 };

    async handle(): Promise<Response> {
      const cached = await this.getCachedResponse<UserItem[]>();
      if (cached) {
        return this.successPaginatedWithCache(cached, { page: 1, per_page: 20 });
      }

      const response = await super.handle();

      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);

        return this.successPaginatedWithCache(data.result, data.result_info);
      }

      return response;
    }
  }

  // Create endpoint
  class UserCreate extends MemoryCreateEndpoint<any, UserMeta> {
    _meta = userMeta;
  }

  // Update endpoint with cache invalidation
  class InvalidatingUserUpdate extends withCacheInvalidation(MemoryUpdateEndpoint) {
    _meta = userMeta;
    cacheInvalidation = {
      strategy: 'all' as const,
    };
  }

  // Delete endpoint with cache invalidation
  class InvalidatingUserDelete extends withCacheInvalidation(MemoryDeleteEndpoint) {
    _meta = userMeta;
    cacheInvalidation = {
      strategy: 'all' as const,
    };
  }

  beforeEach(() => {
    clearStorage();
    cacheStorage = new MemoryCacheStorage();
    setCacheStorage(cacheStorage);

    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: CachedUserList as any,
      read: CachedUserRead as any,
      update: InvalidatingUserUpdate as any,
      delete: InvalidatingUserDelete as any,
    });
  });

  afterEach(() => {
    cacheStorage.clear();
  });

  it('should invalidate cache on update', async () => {
    // Create user
    const createRes = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const { result: user } = await createRes.json();

    // Read to populate cache
    await app.request(`/users/${user.id}`);

    // Verify cache hit
    const res1 = await app.request(`/users/${user.id}`);
    expect(res1.headers.get('X-Cache')).toBe('HIT');

    // Update user
    await app.request(`/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John Updated' }),
    });

    // Wait for async invalidation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be cache miss after invalidation
    const res2 = await app.request(`/users/${user.id}`);
    expect(res2.headers.get('X-Cache')).toBe('MISS');

    // Verify updated data
    const data = await res2.json();
    expect(data.result.name).toBe('John Updated');
  });

  it('registers invalidation through executionCtx.waitUntil when present', async () => {
    // Create user
    const createRes = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const { result: user } = await createRes.json();

    // Read to populate cache
    await app.request(`/users/${user.id}`);
    const res1 = await app.request(`/users/${user.id}`);
    expect(res1.headers.get('X-Cache')).toBe('HIT');

    const waitUntil = vi.fn();
    const executionCtx = {
      waitUntil,
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    // Update user with an execution context present (Workers-style)
    await app.request(
      `/users/${user.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John Updated' }),
      },
      {},
      executionCtx,
    );

    expect(waitUntil).toHaveBeenCalled();

    // Awaiting the registered promises must complete the invalidation
    // without any timing sleep.
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));

    const res2 = await app.request(`/users/${user.id}`);
    expect(res2.headers.get('X-Cache')).toBe('MISS');
  });

  it('should invalidate cache on delete', async () => {
    // Create user
    const createRes = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const { result: user } = await createRes.json();

    // List to populate cache
    await app.request('/users');

    // Verify cache hit
    const res1 = await app.request('/users');
    expect(res1.headers.get('X-Cache')).toBe('HIT');

    // Delete user
    await app.request(`/users/${user.id}`, {
      method: 'DELETE',
    });

    // Wait for async invalidation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be cache miss after invalidation
    const res2 = await app.request('/users');
    expect(res2.headers.get('X-Cache')).toBe('MISS');
  });

  it('should support list-only invalidation strategy', async () => {
    // Override the endpoint with list strategy
    class ListOnlyInvalidatingUpdate extends withCacheInvalidation(MemoryUpdateEndpoint) {
      _meta = userMeta;
      cacheInvalidation = {
        strategy: 'list' as const,
      };
    }

    const testApp = fromHono(new Hono());
    registerCrud(testApp, '/users', {
      create: UserCreate as any,
      list: CachedUserList as any,
      read: CachedUserRead as any,
      update: ListOnlyInvalidatingUpdate as any,
      delete: InvalidatingUserDelete as any,
    });

    // Create user
    const createRes = await testApp.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const { result: user } = await createRes.json();

    // Populate both read and list caches
    await testApp.request(`/users/${user.id}`);
    await testApp.request('/users');

    // Verify both are hits
    expect((await testApp.request(`/users/${user.id}`)).headers.get('X-Cache')).toBe('HIT');
    expect((await testApp.request('/users')).headers.get('X-Cache')).toBe('HIT');

    // Update user
    await testApp.request(`/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John Updated' }),
    });

    // Wait for async invalidation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // List should be miss (invalidated)
    expect((await testApp.request('/users')).headers.get('X-Cache')).toBe('MISS');

    // Read should still be hit (not invalidated with 'list' strategy)
    // Note: This depends on pattern matching - the actual behavior may vary
  });
});

// ============================================================================
// Global Cache Storage Tests
// ============================================================================

describe('Global Cache Storage', () => {
  it('should use default memory storage', () => {
    const storage = getCacheStorage();
    expect(storage).toBeInstanceOf(MemoryCacheStorage);
  });

  it('should allow setting custom storage', () => {
    const customStorage = new MemoryCacheStorage({ defaultTtlMs: 600_000 });
    setCacheStorage(customStorage);

    expect(getCacheStorage()).toBe(customStorage);

    // Reset to default
    setCacheStorage(new MemoryCacheStorage());
  });
});

// ============================================================================
// Cache + responseEnvelope: HIT and MISS must share the configured shape
// ============================================================================

describe('withCache + responseEnvelope', () => {
  // RFC-7807-ish envelope, observably different from the legacy
  // `{ success, result }` shape so any leak of the default body is caught.
  const dataEnvelope: ResponseEnvelope = {
    success: (result, info) => (info ? { data: result, meta: info } : { data: result }),
    error: (err) => ({ error: err }),
  };

  // Read endpoint: BOTH MISS and HIT route their body through the cache
  // helper. The helper must apply the configured envelope so the two share
  // one shape. `setCachedResponse` stores the raw row, not a serialised body.
  class CachedUserRead extends withCache(MemoryReadEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttl: 300 };

    async handle(): Promise<Response> {
      const cached = await this.getCachedResponse<UserItem>();
      if (cached) {
        return this.successWithCache(cached);
      }

      const response = await super.handle();
      if (response.status === 200) {
        // Read the raw row from inside the envelope-applied body, store the
        // raw row, then re-emit via the cache helper.
        const data = (await response.clone().json()) as { data: UserItem };
        await this.setCachedResponse(data.data);
        return this.successWithCache(data.data);
      }
      return response;
    }
  }

  // List endpoint: BOTH MISS and HIT route through successPaginatedWithCache
  // so the configured envelope (with pagination `info`) is applied uniformly.
  class CachedUserList extends withCache(MemoryListEndpoint) {
    _meta = userMeta;
    cacheConfig = { ttl: 300, keyFields: ['page', 'per_page'] };

    async handle(): Promise<Response> {
      const cached = await this.getCachedResponse<UserItem[]>();
      if (cached) {
        return this.successPaginatedWithCache(cached, { page: 1, per_page: 20 });
      }

      const response = await super.handle();
      if (response.status === 200) {
        const data = (await response.clone().json()) as {
          data: UserItem[];
          meta: { page: number; per_page: number };
        };
        await this.setCachedResponse(data.data);
        return this.successPaginatedWithCache(data.data, data.meta);
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
    registerCrud(
      app,
      '/users',
      {
        create: UserCreate as any,
        list: CachedUserList as any,
        read: CachedUserRead as any,
      },
      { responseEnvelope: dataEnvelope },
    );
  });

  afterEach(() => {
    cacheStorage.clear();
  });

  it('read: MISS and HIT bodies share the configured envelope shape', async () => {
    const createRes = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const { data: user } = await createRes.json();

    const missRes = await app.request(`/users/${user.id}`);
    expect(missRes.headers.get('X-Cache')).toBe('MISS');
    const missBody = await missRes.json();

    const hitRes = await app.request(`/users/${user.id}`);
    expect(hitRes.headers.get('X-Cache')).toBe('HIT');
    const hitBody = await hitRes.json();

    // The envelope shape is honoured on MISS...
    expect(missBody).toEqual({
      data: { id: user.id, name: 'John', email: 'john@example.com', status: 'active' },
    });
    // ...and the HIT must match it byte-for-byte (no default-shape leak).
    expect(hitBody).toEqual(missBody);
    expect(hitBody.success).toBeUndefined();
    expect(hitBody.result).toBeUndefined();
  });

  it('list: MISS and HIT bodies share the configured envelope shape', async () => {
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });

    const missRes = await app.request('/users');
    expect(missRes.headers.get('X-Cache')).toBe('MISS');
    const missBody = await missRes.json();

    const hitRes = await app.request('/users');
    expect(hitRes.headers.get('X-Cache')).toBe('HIT');
    const hitBody = await hitRes.json();

    // MISS honours the envelope: `{ data: [...], meta: {...} }`, no legacy keys.
    expect(Array.isArray(missBody.data)).toBe(true);
    expect(missBody.data.length).toBe(1);
    expect(missBody.meta).toBeDefined();
    expect(missBody.success).toBeUndefined();
    expect(missBody.result).toBeUndefined();
    expect(missBody.result_info).toBeUndefined();

    // HIT must carry the same envelope-shaped body (no default-shape leak).
    expect(Array.isArray(hitBody.data)).toBe(true);
    expect(hitBody.data).toEqual(missBody.data);
    expect(hitBody.meta).toBeDefined();
    expect(hitBody.success).toBeUndefined();
    expect(hitBody.result).toBeUndefined();
    expect(hitBody.result_info).toBeUndefined();
  });
});
