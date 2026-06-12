import { Hono } from 'hono';
import { ApiException } from 'hono-crud';
import { type AuthEnv, MemoryAPIKeyStorage, createAPIKeyMiddleware } from 'hono-crud/auth';
import { apiKeyStorageRegistry, setAPIKeyStorage } from 'hono-crud/auth/storage/memory';
import { createStorageMiddleware } from 'hono-crud/storage';
import type { StorageEnv } from 'hono-crud/storage/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// §4.6 — Auth storage path now wired into createAPIKeyMiddleware.
//
// Previously the apiKeyStorage registry was never read by the middleware, so
// `setAPIKeyStorage` was a silent no-op for auth. Now `storage` / a configured
// global / a context-injected apiKeyStorage all resolve, while the legacy
// bare-function `lookupKey` path stays priority-one.

/** Hono app with an ApiException → JSON error handler (mirrors auth.test.ts). */
function createTestApp<E extends AuthEnv = AuthEnv>(): Hono<E> {
  const app = new Hono<E>();
  app.onError((error, c) => {
    if (error instanceof ApiException) {
      return c.json(error.toJSON(), error.status as 401);
    }
    throw error;
  });
  return app;
}

describe('§4.6 API key middleware storage path', () => {
  let storage: MemoryAPIKeyStorage;

  beforeEach(() => {
    storage = new MemoryAPIKeyStorage();
    // apiKeyStorage has no default factory; reset clears any global from a prior test.
    apiKeyStorageRegistry.reset();
  });

  afterEach(() => {
    apiKeyStorageRegistry.reset();
  });

  it('authenticates via config.storage.lookup() with no lookupKey', async () => {
    const { key } = await storage.generateKey({
      userId: 'user-storage',
      roles: ['api-user'],
    });

    const app = createTestApp<AuthEnv>();
    app.use('*', createAPIKeyMiddleware({ storage }));
    app.get('/data', (c) =>
      c.json({ userId: c.var.userId, roles: c.var.roles, authType: c.var.authType }),
    );

    const res = await app.request('/data', { headers: { 'X-API-Key': key } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userId).toBe('user-storage');
    expect(data.authType).toBe('api-key');
  });

  it('fires storage.updateLastUsed(id) after a successful storage-backed auth', async () => {
    const { key, entry } = await storage.generateKey({ userId: 'user-lru' });
    expect(entry.lastUsedAt).toBeUndefined();

    const app = createTestApp<AuthEnv>();
    app.use('*', createAPIKeyMiddleware({ storage }));
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data', { headers: { 'X-API-Key': key } });
    expect(res.status).toBe(200);

    // updateLastUsed is fire-and-forget; let the microtask settle.
    await new Promise((r) => setTimeout(r, 0));
    const stored = await storage.getById(entry.id);
    expect(stored).not.toBeNull();
    expect(stored!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('resolves the global apiKeyStorage set via setAPIKeyStorage', async () => {
    const { key } = await storage.generateKey({ userId: 'user-global' });
    setAPIKeyStorage(storage);

    const app = createTestApp<AuthEnv>();
    // No storage in config → must fall back to the configured global.
    app.use('*', createAPIKeyMiddleware({}));
    app.get('/data', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/data', { headers: { 'X-API-Key': key } });
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe('user-global');
  });

  it('resolves a context-injected apiKeyStorage over an unset global', async () => {
    const { key } = await storage.generateKey({ userId: 'user-ctx' });

    const app = new Hono<StorageEnv & AuthEnv>();
    app.onError((error, c) => {
      if (error instanceof ApiException) {
        return c.json(error.toJSON(), error.status as 401);
      }
      throw error;
    });
    // Inject storage into context, then auth must pick it up.
    app.use('*', createStorageMiddleware({ apiKeyStorage: storage }));
    app.use('*', createAPIKeyMiddleware({}));
    app.get('/data', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/data', { headers: { 'X-API-Key': key } });
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe('user-ctx');
  });

  it('still authenticates via the legacy lookupKey path (regression)', async () => {
    const { key } = await storage.generateKey({ userId: 'user-lookupkey' });

    const app = createTestApp<AuthEnv>();
    app.use('*', createAPIKeyMiddleware({ lookupKey: (hash) => storage.lookup(hash) }));
    app.get('/data', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/data', { headers: { 'X-API-Key': key } });
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe('user-lookupkey');
  });

  it('lookupKey takes priority over storage when both are present', async () => {
    const storageEntry = await storage.generateKey({ userId: 'from-storage' });

    // A second storage holding the SAME key hash but a different userId, wired
    // through lookupKey. lookupKey must win.
    const lookupStore = new MemoryAPIKeyStorage();
    await lookupStore.store({
      ...storageEntry.entry,
      id: crypto.randomUUID(),
      userId: 'from-lookupkey',
    });

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        storage,
        lookupKey: (hash) => lookupStore.lookup(hash),
      }),
    );
    app.get('/data', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/data', { headers: { 'X-API-Key': storageEntry.key } });
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe('from-lookupkey');
  });

  it('throws ConfigurationException when neither lookupKey, storage, nor a global resolves', async () => {
    const app = createTestApp<AuthEnv>();
    app.use('*', createAPIKeyMiddleware({}));
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data', { headers: { 'X-API-Key': 'sk_whatever' } });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.code).toBe('CONFIGURATION_ERROR');
  });
});
