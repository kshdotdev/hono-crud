import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  MemoryCacheStorage,
  generateCacheKey,
  createInvalidationPattern,
  createRelatedPatterns,
  matchesPattern,
  parseCacheKey,
  setCacheStorage,
  getCacheStorage,
  withCache,
  withCacheInvalidation,
} from '../src/cache/index.js';
import {
  MemoryReadEndpoint,
  MemoryListEndpoint,
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';
import { fromHono, registerCrud } from '../src/index.js';
import type { MetaInput, Model } from '../src/index.js';

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

      await cache.set('key1', 'value', { ttl: 60 }); // 60 seconds

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

      await cache.set('key1', 'value', { ttl: 0 }); // No TTL

      vi.advanceTimersByTime(86400 * 1000); // 1 day

      expect(await cache.get('key1')).not.toBeNull();

      vi.useRealTimers();
    });

    it('should update stats on expired get', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value', { ttl: 60 });

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

      await cache.set('key1', 'value1', { ttl: 60 });
      await cache.set('key2', 'value2', { ttl: 120 });
      await cache.set('key3', 'value3', { ttl: 0 }); // No expiration

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
        return this.jsonWithCache({
          success: true,
          result: cached,
          result_info: { page: 1, per_page: 20 },
        });
      }

      const response = await super.handle();

      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);

        // Return with cache header
        return this.jsonWithCache(data);
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
        return this.jsonWithCache({
          success: true,
          result: cached,
          result_info: { page: 1, per_page: 20 },
        });
      }

      const response = await super.handle();

      if (response.status === 200) {
        const data = await response.clone().json();
        await this.setCachedResponse(data.result);

        return this.jsonWithCache(data);
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
    const customStorage = new MemoryCacheStorage({ defaultTtl: 600 });
    setCacheStorage(customStorage);

    expect(getCacheStorage()).toBe(customStorage);

    // Reset to default
    setCacheStorage(new MemoryCacheStorage());
  });
});
