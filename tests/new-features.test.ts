import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryCloneEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';
import type { MetaInput, Model } from '../src/index.js';
import { encodeCursor, decodeCursor } from '../src/core/types.js';
import { generateETag, matchesIfNoneMatch, matchesIfMatch } from '../src/core/etag.js';
import { CrudEventEmitter } from '../src/events/emitter.js';
import { MemoryIdempotencyStorage } from '../src/idempotency/storage/memory.js';
import { idempotency } from '../src/idempotency/middleware.js';

// ============================================================================
// Test Schema
// ============================================================================

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number().optional(),
});

const UserModel: Model<typeof UserSchema> = {
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
};

type UserMeta = MetaInput<typeof UserSchema>;
const userMeta: UserMeta = { model: UserModel };

// ============================================================================
// Endpoint Classes
// ============================================================================

class UserCreate extends MemoryCreateEndpoint<any, UserMeta> {
  _meta = userMeta;
}

class UserRead extends MemoryReadEndpoint<any, UserMeta> {
  _meta = userMeta;
  etagEnabled = true;
}

class UserUpdate extends MemoryUpdateEndpoint<any, UserMeta> {
  _meta = userMeta;
  etagEnabled = true;
}

class UserDelete extends MemoryDeleteEndpoint<any, UserMeta> {
  _meta = userMeta;
}

class UserList extends MemoryListEndpoint<any, UserMeta> {
  _meta = userMeta;
  cursorPaginationEnabled = true;
  cursorField = 'id';
  sortFields = ['name', 'age'];
  defaultSort = { field: 'name', order: 'asc' as const };
  protected defaultPerPage = 2;
}

class UserClone extends MemoryCloneEndpoint<any, UserMeta> {
  _meta = userMeta;
}

// ============================================================================
// Cursor Pagination Tests
// ============================================================================

describe('Cursor-Based Pagination', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: UserList as any,
      read: UserRead as any,
      update: UserUpdate as any,
      delete: UserDelete as any,
    });

    // Seed data
    for (const user of [
      { name: 'Alice', email: 'alice@test.com', age: 30 },
      { name: 'Bob', email: 'bob@test.com', age: 25 },
      { name: 'Charlie', email: 'charlie@test.com', age: 35 },
      { name: 'Diana', email: 'diana@test.com', age: 28 },
    ]) {
      await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
    }
  });

  it('should support cursor-based pagination with limit', async () => {
    const res = await app.request('/users?limit=2');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.result.length).toBe(2);
    expect(data.result_info.has_next_page).toBe(true);
    expect(data.result_info.next_cursor).toBeDefined();
  });

  it('should paginate through results with cursor', async () => {
    // First page
    const res1 = await app.request('/users?limit=2');
    const data1 = await res1.json() as any;
    expect(data1.result.length).toBe(2);
    const nextCursor = data1.result_info.next_cursor;
    expect(nextCursor).toBeDefined();

    // Second page using cursor
    const res2 = await app.request(`/users?cursor=${nextCursor}&limit=2`);
    const data2 = await res2.json() as any;
    expect(data2.result.length).toBe(2);

    // All 4 items should be different
    const allIds = [...data1.result.map((r: any) => r.id), ...data2.result.map((r: any) => r.id)];
    expect(new Set(allIds).size).toBe(4);
  });

  it('should return has_prev_page when using cursor', async () => {
    const res1 = await app.request('/users?limit=2');
    const data1 = await res1.json() as any;
    expect(data1.result_info.has_prev_page).toBe(false);

    const res2 = await app.request(`/users?cursor=${data1.result_info.next_cursor}&limit=2`);
    const data2 = await res2.json() as any;
    expect(data2.result_info.has_prev_page).toBe(true);
  });

  it('should still support offset-based pagination', async () => {
    const res = await app.request('/users?page=1&per_page=2');
    const data = await res.json() as any;
    expect(data.result.length).toBe(2);
    expect(data.result_info.page).toBe(1);
    expect(data.result_info.total_count).toBe(4);
  });
});

// ============================================================================
// Cursor Encoding Tests
// ============================================================================

describe('Cursor Encoding', () => {
  it('should encode and decode string cursor', () => {
    const encoded = encodeCursor('abc-123');
    expect(typeof encoded).toBe('string');
    expect(decodeCursor(encoded)).toBe('abc-123');
  });

  it('should encode and decode numeric cursor', () => {
    const encoded = encodeCursor(42);
    expect(decodeCursor(encoded)).toBe('42');
  });

  it('should return null for invalid cursor', () => {
    expect(decodeCursor('!!invalid!!')).toBe(null);
  });
});

// ============================================================================
// ETag Tests
// ============================================================================

describe('ETag & Conditional Requests', () => {
  let app: ReturnType<typeof fromHono>;
  let userId: string;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      list: UserList as any,
      read: UserRead as any,
      update: UserUpdate as any,
      delete: UserDelete as any,
    });

    // Create a test user
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
    });
    const data = await res.json() as any;
    userId = data.result.id;
  });

  it('should return ETag header on GET', async () => {
    const res = await app.request(`/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
  });

  it('should return 304 Not Modified when If-None-Match matches', async () => {
    // First request to get ETag
    const res1 = await app.request(`/users/${userId}`);
    const etag = res1.headers.get('ETag')!;
    expect(etag).toBeTruthy();

    // Second request with If-None-Match
    const res2 = await app.request(`/users/${userId}`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
  });

  it('should return 200 when If-None-Match does not match', async () => {
    const res = await app.request(`/users/${userId}`, {
      headers: { 'If-None-Match': '"stale-etag"' },
    });
    expect(res.status).toBe(200);
  });

  it('should return ETag on UPDATE response', async () => {
    const res = await app.request(`/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Updated' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
  });

  it('should return 409 Conflict when If-Match does not match', async () => {
    const res = await app.request(`/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"stale-etag"',
      },
      body: JSON.stringify({ name: 'Alice Updated' }),
    });
    expect(res.status).toBe(409);
    const data = await res.json() as any;
    expect(data.error.code).toBe('CONFLICT');
  });

  it('should succeed when If-Match matches current ETag', async () => {
    // Get current ETag
    const res1 = await app.request(`/users/${userId}`);
    const etag = res1.headers.get('ETag')!;

    // Update with matching If-Match
    const res2 = await app.request(`/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify({ name: 'Alice Updated' }),
    });
    expect(res2.status).toBe(200);
  });
});

// ============================================================================
// ETag Utility Tests
// ============================================================================

describe('ETag Utilities', () => {
  it('should generate consistent ETags', async () => {
    const data = { id: 1, name: 'test' };
    const etag1 = await generateETag(data);
    const etag2 = await generateETag(data);
    expect(etag1).toBe(etag2);
  });

  it('should generate different ETags for different data', async () => {
    const etag1 = await generateETag({ id: 1 });
    const etag2 = await generateETag({ id: 2 });
    expect(etag1).not.toBe(etag2);
  });

  it('should wrap ETag in quotes', async () => {
    const etag = await generateETag('test');
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
  });

  it('matchesIfNoneMatch should handle various inputs', () => {
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch('*', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"def"', '"abc"')).toBe(false);
    expect(matchesIfNoneMatch('"abc", "def"', '"abc"')).toBe(true);
  });

  it('matchesIfMatch should handle various inputs', () => {
    expect(matchesIfMatch(null, '"abc"')).toBe(true);  // No header = proceed
    expect(matchesIfMatch(undefined, '"abc"')).toBe(true);
    expect(matchesIfMatch('*', '"abc"')).toBe(true);
    expect(matchesIfMatch('"abc"', '"abc"')).toBe(true);
    expect(matchesIfMatch('"def"', '"abc"')).toBe(false);
  });
});

// ============================================================================
// Clone Endpoint Tests
// ============================================================================

describe('Clone Endpoint', () => {
  let app: ReturnType<typeof fromHono>;
  let userId: string;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/users', {
      create: UserCreate as any,
      read: UserRead as any,
      update: UserUpdate as any,
      delete: UserDelete as any,
      list: UserList as any,
    });

    // Register clone route separately
    app.post('/users/:id/clone', UserClone);

    // Create a test user
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com', age: 30 }),
    });
    const data = await res.json() as any;
    userId = data.result.id;
  });

  it('should clone a record', async () => {
    const res = await app.request(`/users/${userId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.result.name).toBe('Alice');
    expect(data.result.email).toBe('alice@test.com');
    expect(data.result.id).not.toBe(userId); // New ID
  });

  it('should clone with overrides', async () => {
    const res = await app.request(`/users/${userId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Clone', email: 'clone@test.com' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.result.name).toBe('Alice Clone');
    expect(data.result.email).toBe('clone@test.com');
    expect(data.result.age).toBe(30); // Preserved from original
  });

  it('should return 404 for non-existent source', async () => {
    const res = await app.request('/users/nonexistent/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Event System Tests
// ============================================================================

describe('Event System', () => {
  it('should emit and receive events', async () => {
    const emitter = new CrudEventEmitter();
    const received: any[] = [];

    emitter.on('users', 'created', (event) => {
      received.push(event);
    });

    await emitter.emit({
      type: 'created',
      table: 'users',
      recordId: '123',
      data: { id: '123', name: 'Alice' },
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(1);
    expect(received[0].recordId).toBe('123');
  });

  it('should support table-level subscriptions', async () => {
    const emitter = new CrudEventEmitter();
    const received: any[] = [];

    emitter.onTable('users', (event) => {
      received.push(event);
    });

    await emitter.emit({
      type: 'created',
      table: 'users',
      recordId: '1',
      data: null,
      timestamp: new Date().toISOString(),
    });

    await emitter.emit({
      type: 'updated',
      table: 'users',
      recordId: '1',
      data: null,
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(2);
  });

  it('should support global subscriptions', async () => {
    const emitter = new CrudEventEmitter();
    const received: any[] = [];

    emitter.onAny((event) => {
      received.push(event);
    });

    await emitter.emit({ type: 'created', table: 'users', recordId: '1', data: null, timestamp: '' });
    await emitter.emit({ type: 'deleted', table: 'posts', recordId: '2', data: null, timestamp: '' });

    expect(received.length).toBe(2);
  });

  it('should support unsubscription', async () => {
    const emitter = new CrudEventEmitter();
    const received: any[] = [];

    const sub = emitter.on('users', 'created', (event) => {
      received.push(event);
    });

    await emitter.emit({ type: 'created', table: 'users', recordId: '1', data: null, timestamp: '' });
    expect(received.length).toBe(1);

    sub.unsubscribe();

    await emitter.emit({ type: 'created', table: 'users', recordId: '2', data: null, timestamp: '' });
    expect(received.length).toBe(1); // Still 1
  });

  it('should not crash on listener errors', async () => {
    const emitter = new CrudEventEmitter();

    emitter.on('users', 'created', () => {
      throw new Error('listener error');
    });

    // Should not throw
    await emitter.emit({ type: 'created', table: 'users', recordId: '1', data: null, timestamp: '' });
  });

  it('should report correct listener count', () => {
    const emitter = new CrudEventEmitter();
    expect(emitter.listenerCount()).toBe(0);

    emitter.on('users', 'created', () => {});
    emitter.onTable('users', () => {});
    emitter.onAny(() => {});

    expect(emitter.listenerCount()).toBe(3);

    emitter.removeAll();
    expect(emitter.listenerCount()).toBe(0);
  });
});

// ============================================================================
// Idempotency Tests
// ============================================================================

describe('Idempotency Middleware', () => {
  let app: Hono;
  let storage: MemoryIdempotencyStorage;

  beforeEach(() => {
    storage = new MemoryIdempotencyStorage();
    app = new Hono();
    app.use('/*', idempotency({ storage }));
    app.post('/items', (c) => c.json({ success: true, result: { id: crypto.randomUUID() } }, 201));
    app.get('/items', (c) => c.json({ success: true, result: [] }));
  });

  it('should pass through requests without idempotency key', async () => {
    const res = await app.request('/items', { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('should pass through non-enforced methods', async () => {
    const res = await app.request('/items', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('should cache and replay idempotent requests', async () => {
    const key = 'test-key-1';

    // First request
    const res1 = await app.request('/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    });
    expect(res1.status).toBe(201);
    const data1 = await res1.json() as any;

    // Second request with same key — should replay
    const res2 = await app.request('/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    });
    expect(res2.status).toBe(201);
    expect(res2.headers.get('Idempotency-Replayed')).toBe('true');
    const data2 = await res2.json() as any;
    expect(data2.result.id).toBe(data1.result.id); // Same ID
  });

  it('should require idempotency key when configured', async () => {
    const requiredApp = new Hono();
    requiredApp.use('/*', idempotency({ storage, required: true }));
    requiredApp.post('/items', (c) => c.json({ ok: true }));

    const res = await requiredApp.request('/items', { method: 'POST' });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

// ============================================================================
// Idempotency Storage Tests
// ============================================================================

describe('MemoryIdempotencyStorage', () => {
  it('should store and retrieve entries', async () => {
    const storage = new MemoryIdempotencyStorage();
    const entry = {
      key: 'test',
      statusCode: 200,
      body: '{"ok":true}',
      headers: { 'Content-Type': 'application/json' },
      createdAt: Date.now(),
    };

    await storage.set('test', entry, 60000);
    const retrieved = await storage.get('test');
    expect(retrieved).toEqual(entry);
  });

  it('should return null for expired entries', async () => {
    const storage = new MemoryIdempotencyStorage();
    await storage.set('test', {
      key: 'test',
      statusCode: 200,
      body: '',
      headers: {},
      createdAt: Date.now(),
    }, 1); // 1ms TTL

    await new Promise((r) => setTimeout(r, 10));
    const retrieved = await storage.get('test');
    expect(retrieved).toBe(null);
  });

  it('should support locking', async () => {
    const storage = new MemoryIdempotencyStorage();
    const locked = await storage.lock('key1', 5000);
    expect(locked).toBe(true);

    const lockedAgain = await storage.lock('key1', 5000);
    expect(lockedAgain).toBe(false);

    await storage.unlock('key1');
    const lockedAfterUnlock = await storage.lock('key1', 5000);
    expect(lockedAfterUnlock).toBe(true);
  });
});
