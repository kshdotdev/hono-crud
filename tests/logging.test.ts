import { Hono } from 'hono';
import type { ExecutionContext } from 'hono';
import { generateRequestId, getRequestId } from 'hono-crud';
import {
  type LogEntry,
  type LogLevel,
  type LoggingStorage,
  MemoryLoggingStorage,
  createLoggingMiddleware,
  extractHeaders,
  getLoggingStorage,
  getRequestStartTime,
  isAllowedContentType,
  matchPath,
  redactHeaders,
  redactObject,
  setLoggingStorage,
  shouldExcludePath,
  shouldRedact,
  truncateBody,
} from 'hono-crud/logging';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Logging Utilities', () => {
  describe('shouldRedact', () => {
    it('should match exact field names (case-insensitive)', () => {
      expect(shouldRedact('password', ['password'])).toBe(true);
      expect(shouldRedact('PASSWORD', ['password'])).toBe(true);
      expect(shouldRedact('Password', ['password'])).toBe(true);
      expect(shouldRedact('username', ['password'])).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(shouldRedact('api_key', ['*_key'])).toBe(true);
      expect(shouldRedact('secret_key', ['*_key'])).toBe(true);
      expect(shouldRedact('api_token', ['*_token'])).toBe(true);
      expect(shouldRedact('api_key', ['api_*'])).toBe(true);
      expect(shouldRedact('username', ['*_key'])).toBe(false);
    });

    it('should match regex patterns', () => {
      expect(shouldRedact('x-api-key', [/x-api-.*/i])).toBe(true);
      expect(shouldRedact('X-API-TOKEN', [/x-api-.*/i])).toBe(true);
      expect(shouldRedact('authorization', [/^auth/])).toBe(true);
      expect(shouldRedact('username', [/^auth/])).toBe(false);
    });

    it('should handle multiple patterns', () => {
      const patterns = ['password', '*_key', /token/i];
      expect(shouldRedact('password', patterns)).toBe(true);
      expect(shouldRedact('api_key', patterns)).toBe(true);
      expect(shouldRedact('access_token', patterns)).toBe(true);
      expect(shouldRedact('username', patterns)).toBe(false);
    });
  });

  describe('redactObject', () => {
    it('should redact top-level fields', () => {
      const obj = { username: 'test', password: 'secret123' };
      const result = redactObject(obj, ['password']);

      expect(result).toEqual({
        username: 'test',
        password: '[REDACTED]',
      });
    });

    it('should redact nested fields', () => {
      const obj = {
        user: {
          name: 'Alice',
          credentials: {
            password: 'secret',
            token: 'abc123',
          },
        },
      };
      const result = redactObject(obj, ['password', 'token']);

      expect(result).toEqual({
        user: {
          name: 'Alice',
          credentials: {
            password: '[REDACTED]',
            token: '[REDACTED]',
          },
        },
      });
    });

    it('should redact fields in arrays', () => {
      const obj = {
        users: [
          { name: 'Alice', password: 'pass1' },
          { name: 'Bob', password: 'pass2' },
        ],
      };
      const result = redactObject(obj, ['password']) as {
        users: { name: string; password: string }[];
      };

      expect(result.users[0].password).toBe('[REDACTED]');
      expect(result.users[1].password).toBe('[REDACTED]');
      expect(result.users[0].name).toBe('Alice');
    });

    it('should handle null and undefined values', () => {
      expect(redactObject(null, ['password'])).toBeNull();
      expect(redactObject(undefined, ['password'])).toBeUndefined();
    });

    it('should handle primitive values', () => {
      expect(redactObject('string', ['password'])).toBe('string');
      expect(redactObject(123, ['password'])).toBe(123);
      expect(redactObject(true, ['password'])).toBe(true);
    });
  });

  describe('redactHeaders', () => {
    it('should redact matching headers', () => {
      const headers = {
        authorization: 'Bearer token123',
        'content-type': 'application/json',
        'x-api-key': 'secret-key',
      };
      const result = redactHeaders(headers, ['authorization', 'x-api-key']);

      expect(result).toEqual({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
        'x-api-key': '[REDACTED]',
      });
    });

    it('should preserve non-matching headers', () => {
      const headers = { 'content-type': 'application/json', accept: '*/*' };
      const result = redactHeaders(headers, ['authorization']);

      expect(result).toEqual(headers);
    });
  });

  describe('matchPath', () => {
    it('should match exact paths', () => {
      expect(matchPath('/health', '/health')).toBe(true);
      expect(matchPath('/api/users', '/api/users')).toBe(true);
      expect(matchPath('/api/users', '/api/posts')).toBe(false);
    });

    it('should match single wildcard (*)', () => {
      expect(matchPath('/api/users', '/api/*')).toBe(true);
      expect(matchPath('/api/posts', '/api/*')).toBe(true);
      expect(matchPath('/api/users/123', '/api/*')).toBe(false);
      expect(matchPath('/other/users', '/api/*')).toBe(false);
    });

    it('should match double wildcard (**)', () => {
      expect(matchPath('/api/v1/users', '/api/**')).toBe(true);
      expect(matchPath('/api/v1/users/123', '/api/**')).toBe(true);
      expect(matchPath('/api/', '/api/**')).toBe(true);
      expect(matchPath('/other/path', '/api/**')).toBe(false);
    });

    it('should match regex patterns', () => {
      expect(matchPath('/v1/test', /^\/v\d+\/test$/)).toBe(true);
      expect(matchPath('/v2/test', /^\/v\d+\/test$/)).toBe(true);
      expect(matchPath('/va/test', /^\/v\d+\/test$/)).toBe(false);
    });

    it('should handle mixed wildcards', () => {
      expect(matchPath('/api/v1/users', '/api/*/users')).toBe(true);
      expect(matchPath('/api/v2/users', '/api/*/users')).toBe(true);
      expect(matchPath('/api/v1/posts', '/api/*/users')).toBe(false);
    });
  });

  describe('shouldExcludePath', () => {
    it('should exclude paths matching exclude patterns', () => {
      expect(shouldExcludePath('/health', [], ['/health'])).toBe(true);
      expect(shouldExcludePath('/healthz', [], ['/health*'])).toBe(true);
      expect(shouldExcludePath('/api/users', [], ['/health'])).toBe(false);
    });

    it('should include all paths when includePaths is empty', () => {
      expect(shouldExcludePath('/api/users', [], [])).toBe(false);
      expect(shouldExcludePath('/anything', [], [])).toBe(false);
    });

    it('should only include paths matching includePaths', () => {
      expect(shouldExcludePath('/api/users', ['/api/*'], [])).toBe(false);
      expect(shouldExcludePath('/other/path', ['/api/*'], [])).toBe(true);
    });

    it('should prioritize excludePaths over includePaths', () => {
      expect(shouldExcludePath('/api/health', ['/api/**'], ['/api/health'])).toBe(true);
    });
  });

  describe('truncateBody', () => {
    it('should return short strings unchanged', () => {
      expect(truncateBody('hello', 100)).toBe('hello');
    });

    it('should truncate long strings', () => {
      const longString = 'x'.repeat(200);
      const result = truncateBody(longString, 50);
      expect(result).toBe('x'.repeat(50) + '... [TRUNCATED]');
    });

    it('should handle objects within size limit', () => {
      const obj = { name: 'test' };
      expect(truncateBody(obj, 100)).toEqual(obj);
    });

    it('should indicate truncated objects', () => {
      const obj = { name: 'test'.repeat(100) };
      const result = truncateBody(obj, 50) as { _truncated: boolean };
      expect(result._truncated).toBe(true);
    });
  });

  describe('isAllowedContentType', () => {
    it('should allow all types when array is empty', () => {
      expect(isAllowedContentType('application/json', [])).toBe(true);
      expect(isAllowedContentType('text/plain', [])).toBe(true);
    });

    it('should match exact content types', () => {
      expect(isAllowedContentType('application/json', ['application/json'])).toBe(true);
      expect(isAllowedContentType('text/plain', ['application/json'])).toBe(false);
    });

    it('should match partial content types', () => {
      expect(isAllowedContentType('application/json; charset=utf-8', ['application/json'])).toBe(
        true,
      );
    });

    it('should return false for null/undefined', () => {
      expect(isAllowedContentType(null, ['application/json'])).toBe(false);
      expect(isAllowedContentType(undefined, ['application/json'])).toBe(false);
    });
  });

  describe('generateRequestId', () => {
    it('should generate valid UUID format', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(100);
    });
  });
});

// ============================================================================
// Memory Storage Tests
// ============================================================================

describe('MemoryLoggingStorage', () => {
  let storage: MemoryLoggingStorage;

  const createTestEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
    id: generateRequestId(),
    timestamp: new Date().toISOString(),
    level: 'info',
    request: {
      method: 'GET',
      path: '/api/test',
      url: 'http://localhost/api/test',
      clientIp: '127.0.0.1',
    },
    response: {
      statusCode: 200,
      responseTimeMs: 50,
    },
    ...overrides,
  });

  beforeEach(() => {
    storage = new MemoryLoggingStorage({ maxEntries: 100, cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    storage.destroy();
  });

  describe('basic operations', () => {
    it('should store and retrieve entries', async () => {
      const entry = createTestEntry();
      await storage.store(entry);

      const retrieved = await storage.getById(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(entry.id);
    });

    it('should return null for non-existent entry', async () => {
      const retrieved = await storage.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should count entries', async () => {
      await storage.store(createTestEntry());
      await storage.store(createTestEntry());
      await storage.store(createTestEntry());

      const count = await storage.count();
      expect(count).toBe(3);
    });

    it('should clear all entries', async () => {
      await storage.store(createTestEntry());
      await storage.store(createTestEntry());

      const cleared = await storage.clear();
      expect(cleared).toBe(2);
      expect(await storage.count()).toBe(0);
    });
  });

  describe('max entries limit', () => {
    it('should enforce max entries limit', async () => {
      const smallStorage = new MemoryLoggingStorage({ maxEntries: 5, cleanupIntervalMs: 0 });

      for (let i = 0; i < 10; i++) {
        await smallStorage.store(createTestEntry());
      }

      expect(smallStorage.getSize()).toBe(5);
      smallStorage.destroy();
    });

    it('should remove oldest entries when limit exceeded', async () => {
      const smallStorage = new MemoryLoggingStorage({ maxEntries: 3, cleanupIntervalMs: 0 });

      const entry1 = createTestEntry({ id: 'entry-1' });
      const entry2 = createTestEntry({ id: 'entry-2' });
      const entry3 = createTestEntry({ id: 'entry-3' });
      const entry4 = createTestEntry({ id: 'entry-4' });

      await smallStorage.store(entry1);
      await smallStorage.store(entry2);
      await smallStorage.store(entry3);
      await smallStorage.store(entry4);

      // entry1 should have been removed
      expect(await smallStorage.getById('entry-1')).toBeNull();
      expect(await smallStorage.getById('entry-4')).not.toBeNull();

      smallStorage.destroy();
    });
  });

  describe('query filtering', () => {
    beforeEach(async () => {
      // Create a variety of entries
      await storage.store(
        createTestEntry({
          id: 'info-get',
          level: 'info',
          request: { method: 'GET', path: '/api/users', url: 'http://localhost/api/users' },
          response: { statusCode: 200, responseTimeMs: 10 },
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'info-post',
          level: 'info',
          request: { method: 'POST', path: '/api/users', url: 'http://localhost/api/users' },
          response: { statusCode: 201, responseTimeMs: 50 },
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'warn-get',
          level: 'warn',
          request: { method: 'GET', path: '/api/users/123', url: 'http://localhost/api/users/123' },
          response: { statusCode: 404, responseTimeMs: 5 },
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'error-get',
          level: 'error',
          request: { method: 'GET', path: '/api/error', url: 'http://localhost/api/error' },
          response: { statusCode: 500, responseTimeMs: 100 },
          error: { message: 'Internal server error', name: 'Error' },
        }),
      );
    });

    it('should filter by level', async () => {
      const infoLogs = await storage.query({ level: 'info' });
      expect(infoLogs).toHaveLength(2);

      const warnLogs = await storage.query({ level: 'warn' });
      expect(warnLogs).toHaveLength(1);

      const multiLevel = await storage.query({ level: ['warn', 'error'] });
      expect(multiLevel).toHaveLength(2);
    });

    it('should filter by method', async () => {
      const getLogs = await storage.query({ method: 'GET' });
      expect(getLogs).toHaveLength(3);

      const postLogs = await storage.query({ method: 'POST' });
      expect(postLogs).toHaveLength(1);
    });

    it('should filter by status code range', async () => {
      const successLogs = await storage.query({ statusCode: { min: 200, max: 299 } });
      expect(successLogs).toHaveLength(2);

      const errorLogs = await storage.query({ statusCode: { min: 400 } });
      expect(errorLogs).toHaveLength(2);

      const serverErrors = await storage.query({ statusCode: { min: 500, max: 599 } });
      expect(serverErrors).toHaveLength(1);
    });

    it('should filter by path pattern', async () => {
      const usersLogs = await storage.query({ path: '/api/users' });
      expect(usersLogs).toHaveLength(2);

      // /api/* only matches single segment after /api/, so /api/users/123 doesn't match
      const singleSegmentLogs = await storage.query({ path: '/api/*' });
      expect(singleSegmentLogs).toHaveLength(3); // /api/users, /api/users, /api/error

      // Use ** for multi-segment matching
      const allApiLogs = await storage.query({ path: '/api/**' });
      expect(allApiLogs).toHaveLength(4);
    });

    it('should filter by error message', async () => {
      const errorLogs = await storage.query({ errorMessage: 'server error' });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].id).toBe('error-get');
    });

    it('should combine multiple filters', async () => {
      const logs = await storage.query({
        level: 'info',
        method: 'GET',
        statusCode: { min: 200, max: 299 },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('info-get');
    });
  });

  describe('query pagination and sorting', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await storage.store(
          createTestEntry({
            id: `entry-${i}`,
            response: { statusCode: 200, responseTimeMs: i * 10 },
          }),
        );
      }
    });

    it('should limit results', async () => {
      const logs = await storage.query({ limit: 5 });
      expect(logs).toHaveLength(5);
    });

    it('should offset results', async () => {
      const allLogs = await storage.query({});
      const offsetLogs = await storage.query({ offset: 3, limit: 3 });

      expect(offsetLogs).toHaveLength(3);
      expect(offsetLogs[0].id).toBe(allLogs[3].id);
    });

    it('should sort by response time descending', async () => {
      const logs = await storage.query({
        sort: { field: 'responseTimeMs', direction: 'desc' },
        limit: 3,
      });

      expect(logs[0].response.responseTimeMs).toBe(90);
      expect(logs[1].response.responseTimeMs).toBe(80);
      expect(logs[2].response.responseTimeMs).toBe(70);
    });

    it('should sort by response time ascending', async () => {
      const logs = await storage.query({
        sort: { field: 'responseTimeMs', direction: 'asc' },
        limit: 3,
      });

      expect(logs[0].response.responseTimeMs).toBe(0);
      expect(logs[1].response.responseTimeMs).toBe(10);
      expect(logs[2].response.responseTimeMs).toBe(20);
    });

    it('should sort by status code', async () => {
      await storage.clear();
      await storage.store(
        createTestEntry({ id: 'a', response: { statusCode: 500, responseTimeMs: 10 } }),
      );
      await storage.store(
        createTestEntry({ id: 'b', response: { statusCode: 200, responseTimeMs: 10 } }),
      );
      await storage.store(
        createTestEntry({ id: 'c', response: { statusCode: 404, responseTimeMs: 10 } }),
      );

      const logs = await storage.query({
        sort: { field: 'statusCode', direction: 'asc' },
      });

      expect(logs[0].response.statusCode).toBe(200);
      expect(logs[1].response.statusCode).toBe(404);
      expect(logs[2].response.statusCode).toBe(500);
    });
  });

  describe('time-based operations', () => {
    it('should filter by time range', async () => {
      const now = Date.now();

      await storage.store(
        createTestEntry({
          id: 'old',
          timestamp: new Date(now - 3600000).toISOString(), // 1 hour ago
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'recent',
          timestamp: new Date(now - 60000).toISOString(), // 1 minute ago
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'now',
          timestamp: new Date(now).toISOString(),
        }),
      );

      const recentLogs = await storage.query({
        timeRange: {
          start: new Date(now - 120000), // 2 minutes ago
        },
      });

      expect(recentLogs).toHaveLength(2);
    });

    it('should delete entries older than maxAgeMs', async () => {
      const now = Date.now();

      await storage.store(
        createTestEntry({
          id: 'old',
          timestamp: new Date(now - 7200000).toISOString(), // 2 hours ago
        }),
      );
      await storage.store(
        createTestEntry({
          id: 'recent',
          timestamp: new Date(now).toISOString(),
        }),
      );

      const deleted = await storage.deleteOlderThan(3600000); // 1 hour
      expect(deleted).toBe(1);
      expect(await storage.getById('old')).toBeNull();
      expect(await storage.getById('recent')).not.toBeNull();
    });
  });
});

// ============================================================================
// Global Storage Tests
// ============================================================================

describe('Global Storage Management', () => {
  afterEach(() => {
    const storage = getLoggingStorage();
    if (storage?.destroy) {
      storage.destroy();
    }
    // Reset global storage
    setLoggingStorage(null as unknown as LoggingStorage);
  });

  it('should set and get global storage', () => {
    const storage = new MemoryLoggingStorage();
    setLoggingStorage(storage);

    expect(getLoggingStorage()).toBe(storage);
  });

  it('should return null when storage not set', () => {
    expect(getLoggingStorage()).toBeNull();
  });
});

// ============================================================================
// Middleware Tests
// ============================================================================

describe('Logging Middleware', () => {
  let storage: MemoryLoggingStorage;

  beforeEach(() => {
    storage = new MemoryLoggingStorage({ maxEntries: 100, cleanupIntervalMs: 0 });
    setLoggingStorage(storage);
  });

  afterEach(() => {
    storage.destroy();
    setLoggingStorage(null as unknown as LoggingStorage);
  });

  describe('basic functionality', () => {
    it('should log requests', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');

      // Wait for async logging
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].request.method).toBe('GET');
      expect(logs[0].request.path).toBe('/api/test');
      expect(logs[0].response.statusCode).toBe(200);
    });

    it('should add X-Request-ID header', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/test', (c) => c.json({ ok: true }));

      const res = await app.request('/api/test');
      const requestId = res.headers.get('X-Request-ID');

      expect(requestId).not.toBeNull();
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('should set request ID and start time in context', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/test', (c) => {
        const requestId = getRequestId(c);
        const startTime = getRequestStartTime(c);
        return c.json({ requestId, startTime });
      });

      const res = await app.request('/api/test');
      const data = await res.json();

      expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(typeof data.startTime).toBe('number');
    });

    it('should calculate response time', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/slow', async (c) => {
        await new Promise((r) => setTimeout(r, 50));
        return c.json({ ok: true });
      });

      await app.request('/api/slow');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      // Tolerance below the 50ms sleep: Date.now() truncates to whole ms on
      // both reads, so the measured delta can land 1-2ms under the slept time.
      expect(logs[0].response.responseTimeMs).toBeGreaterThanOrEqual(45);
    });
  });

  describe('path exclusion', () => {
    it('should exclude health endpoints by default', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/health', (c) => c.json({ ok: true }));
      app.get('/healthz', (c) => c.json({ ok: true }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/health');
      await app.request('/healthz');
      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].request.path).toBe('/api/test');
    });

    it('should use custom exclude paths', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          excludePaths: ['/internal/*', '/metrics'],
        }),
      );
      app.get('/internal/status', (c) => c.json({ ok: true }));
      app.get('/metrics', (c) => c.text('metrics'));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/internal/status');
      await app.request('/metrics');
      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].request.path).toBe('/api/test');
    });

    it('should not add X-Request-ID to excluded paths', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/health', (c) => c.json({ ok: true }));

      const res = await app.request('/health');
      expect(res.headers.get('X-Request-ID')).toBeNull();
    });
  });

  describe('log levels', () => {
    it('should set level based on status code', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/ok', (c) => c.json({ ok: true }));
      app.get('/not-found', (c) => c.json({ error: 'Not found' }, 404));
      app.get('/error', () => {
        throw new Error('Server error');
      });

      await app.request('/ok');
      await app.request('/not-found');
      try {
        await app.request('/error');
      } catch {}
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});

      const okLog = logs.find((l) => l.request.path === '/ok');
      const notFoundLog = logs.find((l) => l.request.path === '/not-found');
      const errorLog = logs.find((l) => l.request.path === '/error');

      expect(okLog?.level).toBe('info');
      expect(notFoundLog?.level).toBe('warn');
      expect(errorLog?.level).toBe('error');
    });

    it('should use custom level resolver', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          levelResolver: (ctx, responseTimeMs, statusCode) => {
            if (responseTimeMs > 100) return 'warn';
            return 'debug';
          },
        }),
      );
      app.get('/fast', (c) => c.json({ ok: true }));
      app.get('/slow', async (c) => {
        await new Promise((r) => setTimeout(r, 150));
        return c.json({ ok: true });
      });

      await app.request('/fast');
      await app.request('/slow');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      const fastLog = logs.find((l) => l.request.path === '/fast');
      const slowLog = logs.find((l) => l.request.path === '/slow');

      expect(fastLog?.level).toBe('debug');
      expect(slowLog?.level).toBe('warn');
    });
  });

  describe('header and query logging', () => {
    it('should log request headers', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeHeaders: true }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'test-agent',
        },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.headers?.['content-type']).toBe('application/json');
      expect(logs[0].request.headers?.['user-agent']).toBe('test-agent');
    });

    it('should redact sensitive headers', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeHeaders: true }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: {
          Authorization: 'Bearer secret-token',
          'X-API-Key': 'my-api-key',
          Cookie: 'session=abc123',
        },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.headers?.['authorization']).toBe('[REDACTED]');
      expect(logs[0].request.headers?.['x-api-key']).toBe('[REDACTED]');
      expect(logs[0].request.headers?.['cookie']).toBe('[REDACTED]');
    });

    it('should log query parameters', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeQuery: true }));
      app.get('/api/search', (c) => c.json({ ok: true }));

      await app.request('/api/search?q=test&page=1');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.query?.q).toBe('test');
      expect(logs[0].request.query?.page).toBe('1');
    });

    it('should skip headers when disabled', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeHeaders: false }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: { 'X-Custom': 'value' },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.headers).toBeUndefined();
    });
  });

  describe('body logging', () => {
    it('should log request body when enabled', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          requestBody: { enabled: true },
        }),
      );
      app.post('/api/users', async (c) => {
        await c.req.json();
        return c.json({ ok: true }, 201);
      });

      await app.request('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.body).toEqual({ name: 'Alice', email: 'alice@example.com' });
    });

    it('should redact sensitive body fields', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          requestBody: { enabled: true },
        }),
      );
      app.post('/api/login', async (c) => {
        await c.req.json();
        return c.json({ ok: true });
      });

      await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'secret123', token: 'abc' }),
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      const body = logs[0].request.body as { username: string; password: string; token: string };
      expect(body.username).toBe('alice');
      expect(body.password).toBe('[REDACTED]');
      expect(body.token).toBe('[REDACTED]');
    });

    it('should log response body when enabled', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          responseBody: { enabled: true },
        }),
      );
      app.get('/api/users', (c) => c.json({ users: [{ id: 1, name: 'Alice' }] }));

      await app.request('/api/users');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].response.body).toEqual({ users: [{ id: 1, name: 'Alice' }] });
    });

    it('should redact sensitive response body fields', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          responseBody: { enabled: true },
        }),
      );
      app.get('/api/profile', (c) =>
        c.json({
          name: 'Alice',
          apiKey: 'secret-key',
          token: 'jwt-token',
        }),
      );

      await app.request('/api/profile');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      const body = logs[0].response.body as { name: string; apiKey: string; token: string };
      expect(body.name).toBe('Alice');
      expect(body.apiKey).toBe('[REDACTED]');
      expect(body.token).toBe('[REDACTED]');
    });

    it('should truncate large bodies', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          requestBody: { enabled: true, maxSize: 100 },
        }),
      );
      app.post('/api/data', async (c) => {
        await c.req.json();
        return c.json({ ok: true });
      });

      const largeBody = { data: 'x'.repeat(1000) };
      await app.request('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largeBody),
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      const body = logs[0].request.body as { _truncated?: boolean };
      expect(body._truncated).toBe(true);
    });

    it('should filter body logging by content type', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          requestBody: { enabled: true, contentTypes: ['application/json'] },
        }),
      );
      app.post('/api/json', async (c) => {
        await c.req.text();
        return c.json({ ok: true });
      });
      app.post('/api/text', async (c) => {
        await c.req.text();
        return c.json({ ok: true });
      });

      // JSON should be logged
      await app.request('/api/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'json' }),
      });

      // Text should not be logged
      await app.request('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'plain text',
      });

      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      // Logs are ordered newest-first
      const jsonLog = logs.find((l) => l.request.path === '/api/json');
      const textLog = logs.find((l) => l.request.path === '/api/text');

      expect(jsonLog?.request.body).toEqual({ data: 'json' });
      expect(textLog?.request.body).toBeUndefined();
    });
  });

  describe('error logging', () => {
    it('should set error level for 5xx responses', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/error', () => {
        throw new Error('Something went wrong');
      });
      // Add error handler - note: Hono intercepts errors before our middleware's catch
      app.onError((err, c) => {
        return c.json({ error: err.message }, 500);
      });

      const res = await app.request('/api/error');
      expect(res.status).toBe(500);

      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].response.statusCode).toBe(500);
      expect(logs[0].level).toBe('error');
    });

    it('should capture error when thrown in middleware before next()', async () => {
      const app = new Hono();

      // Custom middleware that throws before next()
      app.use('*', async (ctx, next) => {
        // Simulate an error that our logging middleware will catch
        throw new Error('Middleware error');
      });

      // Logging middleware won't be reached in this case, so test differently
      // Instead, let's test error capture by having logging middleware BEFORE the throwing middleware
      const app2 = new Hono();
      app2.use('*', createLoggingMiddleware());
      app2.use('/error', async () => {
        throw new Error('Handler error');
      });
      app2.get('/error', (c) => c.json({ ok: true }));

      // Hono's default error handling returns 500
      const res = await app2.request('/error');
      expect(res.status).toBe(500);

      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].response.statusCode).toBe(500);
    });

    it('should handle 4xx errors as warnings', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/not-found', (c) => c.json({ error: 'Not found' }, 404));
      app.get('/api/bad-request', (c) => c.json({ error: 'Bad request' }, 400));

      await app.request('/api/not-found');
      await app.request('/api/bad-request');

      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.level === 'warn')).toBe(true);
    });
  });

  describe('metadata', () => {
    it('should add static metadata', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          metadata: { service: 'test-api', version: '1.0.0' },
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].metadata).toEqual({ service: 'test-api', version: '1.0.0' });
    });

    it('should add dynamic metadata from function', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          metadata: (ctx) => ({
            userAgent: ctx.req.header('User-Agent'),
            path: ctx.req.path,
          }),
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: { 'User-Agent': 'custom-agent' },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].metadata?.userAgent).toBe('custom-agent');
      expect(logs[0].metadata?.path).toBe('/api/test');
    });
  });

  describe('custom handlers', () => {
    it('should call custom handlers', async () => {
      const handler = vi.fn();

      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          handlers: [handler],
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].request.path).toBe('/api/test');
    });

    it('should call multiple handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          handlers: [handler1, handler2],
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('formatter', () => {
    it('should transform entries with formatter', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          formatter: (entry) => ({
            ...entry,
            metadata: { ...entry.metadata, transformed: true },
          }),
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].metadata?.transformed).toBe(true);
    });
  });

  describe('disabled middleware', () => {
    it('should skip logging when disabled', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ enabled: false }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      const res = await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(0);
      expect(res.headers.get('X-Request-ID')).toBeNull();
    });
  });

  describe('minimum response time filter', () => {
    it('should skip logging for fast requests', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ minResponseTimeMs: 100 }));
      app.get('/fast', (c) => c.json({ ok: true }));
      app.get('/slow', async (c) => {
        await new Promise((r) => setTimeout(r, 150));
        return c.json({ ok: true });
      });

      await app.request('/fast');
      await app.request('/slow');
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].request.path).toBe('/slow');
    });
  });

  describe('custom request ID generator', () => {
    it('should use custom request ID generator', async () => {
      let counter = 0;
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          generateRequestId: () => `custom-${++counter}`,
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/api/test');
      const res2 = await app.request('/api/test');

      expect(res1.headers.get('X-Request-ID')).toBe('custom-1');
      expect(res2.headers.get('X-Request-ID')).toBe('custom-2');
    });
  });

  describe('client IP extraction', () => {
    it('should extract client IP from X-Forwarded-For', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeClientIp: true }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.clientIp).toBe('1.2.3.4');
    });

    it('should extract client IP from X-Real-IP', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware({ includeClientIp: true }));
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: { 'X-Real-IP': '10.0.0.1' },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.clientIp).toBe('10.0.0.1');
    });

    it('should use custom IP header', async () => {
      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          includeClientIp: true,
          ipHeader: 'X-Custom-IP',
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test', {
        headers: { 'X-Custom-IP': '192.168.1.1' },
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await storage.query({});
      expect(logs[0].request.clientIp).toBe('192.168.1.1');
    });
  });

  describe('error handling', () => {
    it('should call onError when storage fails', async () => {
      const onError = vi.fn();
      const failingStorage: LoggingStorage = {
        store: async () => {
          throw new Error('Storage error');
        },
        query: async () => [],
        getById: async () => null,
        count: async () => 0,
        deleteOlderThan: async () => 0,
        clear: async () => 0,
      };

      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          storage: failingStorage,
          onError,
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toBe('Storage error');
    });

    it('should call onError when handler fails', async () => {
      const onError = vi.fn();

      const app = new Hono();
      app.use(
        '*',
        createLoggingMiddleware({
          handlers: [
            () => {
              throw new Error('Handler error');
            },
          ],
          onError,
        }),
      );
      app.get('/api/test', (c) => c.json({ ok: true }));

      await app.request('/api/test');
      await new Promise((r) => setTimeout(r, 50));

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toBe('Handler error');
    });
  });

  describe('waitUntil registration', () => {
    it('registers the log flush through executionCtx.waitUntil when present', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/api/test', (c) => c.json({ ok: true }));

      const waitUntil = vi.fn();
      const executionCtx = {
        waitUntil,
        passThroughOnException: () => {},
      } as unknown as ExecutionContext;

      await app.request('/api/test', {}, {}, executionCtx);

      expect(waitUntil).toHaveBeenCalledTimes(1);

      // The registered promise is the flush itself: awaiting it must leave
      // the entry persisted without any timing sleep.
      await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));

      const logs = await storage.query({});
      expect(logs).toHaveLength(1);
      expect(logs[0].request.path).toBe('/api/test');
    });
  });
});
