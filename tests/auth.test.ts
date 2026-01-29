import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createAuthMiddleware,
  createJWTMiddleware,
  createAPIKeyMiddleware,
  optionalAuth,
  requireRoles,
  requireAllRoles,
  requirePermissions,
  requireAnyPermission,
  requireOwnership,
  requireOwnershipOrRole,
  allOf,
  anyOf,
  withAuth,
  MemoryAPIKeyStorage,
  generateAPIKey,
  hashAPIKey,
  isValidAPIKeyFormat,
  fromHono,
  registerCrud,
  ApiException,
  type AuthEnv,
  type JWTClaims,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';
import type { MetaInput, Model } from '../src/index.js';

/**
 * Creates a Hono app with error handling for ApiException.
 */
function createTestApp<E extends AuthEnv = AuthEnv>(): Hono<E> {
  const app = new Hono<E>();

  // Add error handler for ApiException
  app.onError((error, c) => {
    if (error instanceof ApiException) {
      return c.json(error.toJSON(), error.status as 401);
    }
    throw error;
  });

  return app;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple JWT for testing.
 * This is a simplified version - production code should use proper JWT libraries.
 */
async function createTestJWT(
  payload: JWTClaims,
  secret: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };

  const base64UrlEncode = (obj: unknown): string => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const headerB64 = base64UrlEncode(header);
  const payloadB64 = base64UrlEncode(payload);
  const signedContent = `${headerB64}.${payloadB64}`;

  // Sign with HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${signedContent}.${sigB64}`;
}

// ============================================================================
// JWT Middleware Tests
// ============================================================================

describe('JWT Middleware', () => {
  const secret = 'test-secret-key-that-is-at-least-32-bytes';

  it('should authenticate with valid JWT', async () => {
    const app = createTestApp<AuthEnv>();

    app.use('*', createJWTMiddleware({ secret }));
    app.get('/me', (c) => c.json({ userId: c.var.userId, user: c.var.user }));

    const token = await createTestJWT(
      {
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['admin'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret
    );

    const res = await app.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userId).toBe('user-123');
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.roles).toEqual(['admin']);
  });

  it('should reject missing token', async () => {
    const app = createTestApp<AuthEnv>();

    app.use('*', createJWTMiddleware({ secret }));
    app.get('/me', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/me');

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject expired token', async () => {
    const app = createTestApp<AuthEnv>();

    app.use('*', createJWTMiddleware({ secret }));
    app.get('/me', (c) => c.json({ userId: c.var.userId }));

    const token = await createTestJWT(
      {
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      },
      secret
    );

    const res = await app.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toContain('expired');
  });

  it('should reject invalid signature', async () => {
    const app = createTestApp<AuthEnv>();

    app.use('*', createJWTMiddleware({ secret }));
    app.get('/me', (c) => c.json({ userId: c.var.userId }));

    const token = await createTestJWT(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 },
      'wrong-secret-key-that-is-also-32-bytes'
    );

    const res = await app.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toContain('signature');
  });

  it('should validate issuer claim', async () => {
    const app = createTestApp<AuthEnv>();

    app.use('*', createJWTMiddleware({ secret, issuer: 'my-app' }));
    app.get('/me', (c) => c.json({ userId: c.var.userId }));

    // Token with wrong issuer
    const wrongIssuer = await createTestJWT(
      { sub: 'user-123', iss: 'other-app', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );

    const res1 = await app.request('/me', {
      headers: { Authorization: `Bearer ${wrongIssuer}` },
    });
    expect(res1.status).toBe(401);

    // Token with correct issuer
    const correctIssuer = await createTestJWT(
      { sub: 'user-123', iss: 'my-app', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );

    const res2 = await app.request('/me', {
      headers: { Authorization: `Bearer ${correctIssuer}` },
    });
    expect(res2.status).toBe(200);
  });
});

// ============================================================================
// API Key Middleware Tests
// ============================================================================

describe('API Key Middleware', () => {
  let storage: MemoryAPIKeyStorage;

  beforeEach(() => {
    storage = new MemoryAPIKeyStorage();
  });

  it('should authenticate with valid API key', async () => {
    const { key } = await storage.generateKey({
      userId: 'user-123',
      roles: ['api-user'],
      permissions: ['read', 'write'],
    });

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) =>
      c.json({
        userId: c.var.userId,
        roles: c.var.roles,
        authType: c.var.authType,
      })
    );

    const res = await app.request('/data', {
      headers: { 'X-API-Key': key },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userId).toBe('user-123');
    expect(data.roles).toEqual(['api-user']);
    expect(data.authType).toBe('api-key');
  });

  it('should reject missing API key', async () => {
    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data');

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject invalid API key', async () => {
    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data', {
      headers: { 'X-API-Key': 'invalid-key' },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toContain('Invalid');
  });

  it('should reject revoked API key', async () => {
    const { key, entry } = await storage.generateKey({
      userId: 'user-123',
    });
    await storage.revoke(entry.id);

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data', {
      headers: { 'X-API-Key': key },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toContain('revoked');
  });

  it('should reject expired API key', async () => {
    const { key } = await storage.generateKey({
      userId: 'user-123',
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
    });

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) => c.json({ ok: true }));

    const res = await app.request('/data', {
      headers: { 'X-API-Key': key },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toContain('expired');
  });

  it('should use custom header name', async () => {
    const { key } = await storage.generateKey({ userId: 'user-123' });

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAPIKeyMiddleware({
        headerName: 'X-Custom-Key',
        lookupKey: (hash) => storage.lookup(hash),
      })
    );
    app.get('/data', (c) => c.json({ userId: c.var.userId }));

    const res = await app.request('/data', {
      headers: { 'X-Custom-Key': key },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userId).toBe('user-123');
  });
});

// ============================================================================
// Combined Auth Middleware Tests
// ============================================================================

describe('Combined Auth Middleware', () => {
  const secret = 'test-secret-key-that-is-at-least-32-bytes';
  let storage: MemoryAPIKeyStorage;

  beforeEach(() => {
    storage = new MemoryAPIKeyStorage();
  });

  it('should authenticate with JWT', async () => {
    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAuthMiddleware({
        jwt: { secret },
        apiKey: { lookupKey: (hash) => storage.lookup(hash) },
      })
    );
    app.get('/me', (c) => c.json({ authType: c.var.authType }));

    const token = await createTestJWT(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );

    const res = await app.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authType).toBe('jwt');
  });

  it('should authenticate with API key', async () => {
    const { key } = await storage.generateKey({ userId: 'user-123' });

    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAuthMiddleware({
        jwt: { secret },
        apiKey: { lookupKey: (hash) => storage.lookup(hash) },
      })
    );
    app.get('/me', (c) => c.json({ authType: c.var.authType }));

    const res = await app.request('/me', {
      headers: { 'X-API-Key': key },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authType).toBe('api-key');
  });

  it('should skip configured paths', async () => {
    const app = createTestApp<AuthEnv>();
    app.use(
      '*',
      createAuthMiddleware({
        jwt: { secret },
        skipPaths: ['/health', '/docs/*'],
      })
    );
    app.get('/health', (c) => c.json({ ok: true }));
    app.get('/docs/swagger', (c) => c.json({ ok: true }));
    app.get('/api', (c) => c.json({ ok: true }));

    // Skip paths should work without auth
    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);

    const docsRes = await app.request('/docs/swagger');
    expect(docsRes.status).toBe(200);

    // Non-skip paths should require auth
    const apiRes = await app.request('/api');
    expect(apiRes.status).toBe(401);
  });

  it('should allow unauthenticated with optionalAuth', async () => {
    const app = createTestApp<AuthEnv>();
    app.use('*', optionalAuth({ jwt: { secret } }));
    app.get('/public', (c) =>
      c.json({
        authenticated: !!c.var.user,
        userId: c.var.userId,
      })
    );

    // Without auth
    const res1 = await app.request('/public');
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.authenticated).toBe(false);

    // With auth
    const token = await createTestJWT(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const res2 = await app.request('/public', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.authenticated).toBe(true);
    expect(data2.userId).toBe('user-123');
  });
});

// ============================================================================
// Guard Tests
// ============================================================================

describe('Guards', () => {
  const secret = 'test-secret-key-that-is-at-least-32-bytes';

  async function createAppWithUser(roles: string[] = [], permissions: string[] = []) {
    const app = createTestApp<AuthEnv>();
    app.use('*', createAuthMiddleware({ jwt: { secret } }));

    const token = await createTestJWT(
      {
        sub: 'user-123',
        roles,
        permissions,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret
    );

    return { app, token };
  }

  describe('requireRoles', () => {
    it('should allow user with matching role', async () => {
      const { app, token } = await createAppWithUser(['admin']);
      app.use('/admin/*', requireRoles('admin'));
      app.get('/admin/dashboard', (c) => c.json({ ok: true }));

      const res = await app.request('/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should allow user with any matching role', async () => {
      const { app, token } = await createAppWithUser(['moderator']);
      app.use('/admin/*', requireRoles('admin', 'moderator'));
      app.get('/admin/dashboard', (c) => c.json({ ok: true }));

      const res = await app.request('/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should deny user without matching role', async () => {
      const { app, token } = await createAppWithUser(['user']);
      app.use('/admin/*', requireRoles('admin'));
      app.get('/admin/dashboard', (c) => c.json({ ok: true }));

      const res = await app.request('/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('requireAllRoles', () => {
    it('should allow user with all roles', async () => {
      const { app, token } = await createAppWithUser(['admin', 'verified']);
      app.use('/super/*', requireAllRoles('admin', 'verified'));
      app.get('/super/settings', (c) => c.json({ ok: true }));

      const res = await app.request('/super/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should deny user missing any role', async () => {
      const { app, token } = await createAppWithUser(['admin']);
      app.use('/super/*', requireAllRoles('admin', 'verified'));
      app.get('/super/settings', (c) => c.json({ ok: true }));

      const res = await app.request('/super/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('requirePermissions', () => {
    it('should allow user with all permissions', async () => {
      const { app, token } = await createAppWithUser([], ['users:read', 'users:write']);
      app.use('/users/*', requirePermissions('users:read', 'users:write'));
      app.get('/users/list', (c) => c.json({ ok: true }));

      const res = await app.request('/users/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should deny user missing any permission', async () => {
      const { app, token } = await createAppWithUser([], ['users:read']);
      app.use('/users/*', requirePermissions('users:read', 'users:write'));
      app.get('/users/list', (c) => c.json({ ok: true }));

      const res = await app.request('/users/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('requireAnyPermission', () => {
    it('should allow user with any permission', async () => {
      const { app, token } = await createAppWithUser([], ['users:read']);
      app.use('/data/*', requireAnyPermission('users:read', 'users:write'));
      app.get('/data/view', (c) => c.json({ ok: true }));

      const res = await app.request('/data/view', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('requireOwnership', () => {
    it('should allow resource owner', async () => {
      const { app, token } = await createAppWithUser();
      app.use('/users/:id/*', requireOwnership((c) => c.req.param('id')));
      app.get('/users/:id/profile', (c) => c.json({ ok: true }));

      const res = await app.request('/users/user-123/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should deny non-owner', async () => {
      const { app, token } = await createAppWithUser();
      app.use('/users/:id/*', requireOwnership((c) => c.req.param('id')));
      app.get('/users/:id/profile', (c) => c.json({ ok: true }));

      const res = await app.request('/users/other-user/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('requireOwnershipOrRole', () => {
    it('should allow owner', async () => {
      const { app, token } = await createAppWithUser();
      app.use(
        '/posts/:id/*',
        requireOwnershipOrRole((c) => c.req.param('id'), 'admin')
      );
      app.get('/posts/:id/edit', (c) => c.json({ ok: true }));

      const res = await app.request('/posts/user-123/edit', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should allow admin', async () => {
      const { app, token } = await createAppWithUser(['admin']);
      app.use(
        '/posts/:id/*',
        requireOwnershipOrRole((c) => c.req.param('id'), 'admin')
      );
      app.get('/posts/:id/edit', (c) => c.json({ ok: true }));

      const res = await app.request('/posts/other-user/edit', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('should deny non-owner non-admin', async () => {
      const { app, token } = await createAppWithUser();
      app.use(
        '/posts/:id/*',
        requireOwnershipOrRole((c) => c.req.param('id'), 'admin')
      );
      app.get('/posts/:id/edit', (c) => c.json({ ok: true }));

      const res = await app.request('/posts/other-user/edit', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Guard Composition', () => {
    it('allOf should require all guards to pass', async () => {
      const { app, token } = await createAppWithUser(['admin'], ['secure:access']);
      app.use(
        '/secure/*',
        allOf(requireRoles('admin'), requirePermissions('secure:access'))
      );
      app.get('/secure/data', (c) => c.json({ ok: true }));

      const res = await app.request('/secure/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('allOf should fail if any guard fails', async () => {
      const { app, token } = await createAppWithUser(['admin'], []);
      app.use(
        '/secure/*',
        allOf(requireRoles('admin'), requirePermissions('secure:access'))
      );
      app.get('/secure/data', (c) => c.json({ ok: true }));

      const res = await app.request('/secure/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });

    it('anyOf should pass if any guard passes', async () => {
      const { app, token } = await createAppWithUser(['admin'], []);
      app.use(
        '/shared/*',
        anyOf(requireRoles('admin'), requirePermissions('shared:access'))
      );
      app.get('/shared/data', (c) => c.json({ ok: true }));

      const res = await app.request('/shared/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it('anyOf should fail if all guards fail', async () => {
      const { app, token } = await createAppWithUser(['user'], []);
      app.use(
        '/shared/*',
        anyOf(requireRoles('admin'), requirePermissions('shared:access'))
      );
      app.get('/shared/data', (c) => c.json({ ok: true }));

      const res = await app.request('/shared/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });
  });
});

// ============================================================================
// withAuth Mixin Tests
// ============================================================================

describe('withAuth Mixin', () => {
  const secret = 'test-secret-key-that-is-at-least-32-bytes';

  // Define test schema
  const ItemSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    createdBy: z.string().optional(),
  });

  const ItemModel: Model<typeof ItemSchema> = {
    tableName: 'items',
    schema: ItemSchema,
    primaryKeys: ['id'],
  };

  type ItemMeta = MetaInput<typeof ItemSchema>;
  const itemMeta: ItemMeta = { model: ItemModel };

  // Create authenticated endpoint
  class AuthenticatedItemCreate extends withAuth(MemoryCreateEndpoint) {
    _meta = itemMeta;
    requiresAuth = true;
    requiredRoles = ['admin'];

    async before(data: z.infer<typeof ItemSchema>) {
      // Enforce auth before processing
      await this.enforceAuth();
      // Add createdBy from authenticated user
      return { ...data, createdBy: this.getUserId() };
    }
  }

  class PublicItemList extends withAuth(MemoryListEndpoint) {
    _meta = itemMeta;
    requiresAuth = false;
  }

  beforeEach(() => {
    clearStorage();
  });

  it('should enforce auth on protected endpoint', async () => {
    const app = fromHono(new Hono<AuthEnv>());

    // Add global error handler
    app.onError((error, c) => {
      if (error instanceof ApiException) {
        return c.json(error.toJSON(), error.status as 401);
      }
      throw error;
    });

    app.use('*', createAuthMiddleware({ jwt: { secret } }));
    registerCrud(app, '/items', {
      create: AuthenticatedItemCreate as any,
      list: PublicItemList as any,
    });

    // Without auth
    const res1 = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res1.status).toBe(401);

    // With auth but wrong role
    const userToken = await createTestJWT(
      { sub: 'user-123', roles: ['user'], exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const res2 = await app.request('/items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res2.status).toBe(403);

    // With auth and correct role
    const adminToken = await createTestJWT(
      { sub: 'admin-123', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    const res3 = await app.request('/items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res3.status).toBe(201);
    const data = await res3.json();
    expect(data.result.createdBy).toBe('admin-123');
  });

  it('should allow public endpoint without auth', async () => {
    const app = fromHono(new Hono<AuthEnv>());
    app.use('*', optionalAuth({ jwt: { secret } }));
    registerCrud(app, '/items', {
      list: PublicItemList as any,
    });

    const res = await app.request('/items');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// API Key Storage Tests
// ============================================================================

describe('MemoryAPIKeyStorage', () => {
  let storage: MemoryAPIKeyStorage;

  beforeEach(() => {
    storage = new MemoryAPIKeyStorage();
  });

  it('should generate and store API keys', async () => {
    const { key, entry } = await storage.generateKey({
      userId: 'user-123',
      name: 'My API Key',
      roles: ['api-user'],
    });

    expect(key).toMatch(/^sk_[A-Za-z0-9]{32}$/);
    expect(entry.userId).toBe('user-123');
    expect(entry.name).toBe('My API Key');
    expect(entry.active).toBe(true);

    // Should be able to look up by hash
    const hash = await hashAPIKey(key);
    const found = await storage.lookup(hash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(entry.id);
  });

  it('should revoke API keys', async () => {
    const { key, entry } = await storage.generateKey({ userId: 'user-123' });

    // Revoke
    const revoked = await storage.revoke(entry.id);
    expect(revoked).toBe(true);

    // Should still exist but be inactive
    const hash = await hashAPIKey(key);
    const found = await storage.lookup(hash);
    expect(found?.active).toBe(false);
  });

  it('should delete API keys', async () => {
    const { key, entry } = await storage.generateKey({ userId: 'user-123' });

    // Delete
    const deleted = await storage.delete(entry.id);
    expect(deleted).toBe(true);

    // Should not exist
    const hash = await hashAPIKey(key);
    const found = await storage.lookup(hash);
    expect(found).toBeNull();
  });

  it('should get keys by user ID', async () => {
    await storage.generateKey({ userId: 'user-1', name: 'Key 1' });
    await storage.generateKey({ userId: 'user-1', name: 'Key 2' });
    await storage.generateKey({ userId: 'user-2', name: 'Key 3' });

    const user1Keys = await storage.getByUserId('user-1');
    expect(user1Keys.length).toBe(2);

    const user2Keys = await storage.getByUserId('user-2');
    expect(user2Keys.length).toBe(1);
  });

  it('should use custom prefix', async () => {
    const { key } = await storage.generateKey({
      userId: 'user-123',
      prefix: 'pk',
    });

    expect(key).toMatch(/^pk_[A-Za-z0-9]{32}$/);
  });
});

describe('API Key Utilities', () => {
  it('generateAPIKey should create valid keys', () => {
    const key = generateAPIKey('sk');
    expect(key).toMatch(/^sk_[A-Za-z0-9]{32}$/);
  });

  it('generateAPIKey should support custom length', () => {
    const key = generateAPIKey('sk', 16);
    expect(key).toMatch(/^sk_[A-Za-z0-9]{16}$/);
  });

  it('hashAPIKey should create consistent hashes', async () => {
    const key = 'sk_abc123';
    const hash1 = await hashAPIKey(key);
    const hash2 = await hashAPIKey(key);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex string
  });

  it('isValidAPIKeyFormat should validate key format', () => {
    expect(isValidAPIKeyFormat('sk_abc123def456ghi789')).toBe(true);
    expect(isValidAPIKeyFormat('pk_abc123def456ghi789', 'pk')).toBe(true);
    expect(isValidAPIKeyFormat('sk_abc123def456ghi789', 'pk')).toBe(false);
    expect(isValidAPIKeyFormat('invalidkey')).toBe(false);
    expect(isValidAPIKeyFormat('sk_short')).toBe(false);
    expect(isValidAPIKeyFormat('')).toBe(false);
  });
});
