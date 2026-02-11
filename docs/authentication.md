# Authentication

hono-crud provides JWT and API Key authentication middleware, plus composable authorization guards.

---

## JWT Middleware

```typescript
import { Hono } from 'hono';
import { createJWTMiddleware } from 'hono-crud';
import type { AuthEnv } from 'hono-crud';

const app = new Hono<AuthEnv>();

app.use('/api/*', createJWTMiddleware({
  secret: process.env.JWT_SECRET!,
  algorithm: 'HS256',     // default
  issuer: 'my-app',       // optional: validate iss claim
  audience: 'my-api',     // optional: validate aud claim
  clockTolerance: 30,     // optional: seconds of clock skew tolerance
}));

// After middleware runs, context variables are available:
app.get('/api/me', (c) => {
  return c.json({
    userId: c.var.userId,
    user: c.var.user,        // { id, email, roles, permissions, metadata }
    roles: c.var.roles,      // string[]
    authType: c.var.authType // 'jwt'
  });
});
```

### Custom Token Extraction

```typescript
app.use('/api/*', createJWTMiddleware({
  secret: process.env.JWT_SECRET!,
  extractToken: (ctx) => {
    // Extract from cookie instead of Authorization header
    return ctx.req.header('X-Auth-Token') ?? null;
  },
  extractUser: (claims) => ({
    id: String(claims.sub),
    email: claims.email as string,
    roles: claims.realm_access?.roles as string[],
    permissions: claims.scope?.split(' ') as string[],
  }),
}));
```

### Manual Token Verification

```typescript
import { verifyJWT, decodeJWT } from 'hono-crud';

// Verify and decode
const claims = await verifyJWT(token, { secret: process.env.JWT_SECRET! });

// Decode without verification (for debugging)
const decoded = decodeJWT(token); // { header, payload } | null
```

---

## API Key Middleware

```typescript
import {
  createAPIKeyMiddleware,
  MemoryAPIKeyStorage,
  setAPIKeyStorage,
  generateAPIKey,
} from 'hono-crud';

// Setup storage
const apiKeyStorage = new MemoryAPIKeyStorage();
setAPIKeyStorage(apiKeyStorage);

// Generate and store an API key
const key = generateAPIKey();
await apiKeyStorage.store({
  keyHash: await hashAPIKey(key),
  name: 'My API Key',
  userId: 'user-123',
  roles: ['admin'],
  permissions: ['users:read', 'users:write'],
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
});

// Apply middleware
app.use('/api/*', createAPIKeyMiddleware({
  header: 'X-API-Key',     // default
  // Or: queryParam: 'api_key'
}));
```

---

## Combined Auth

Support both JWT and API Key on the same routes:

```typescript
import { createAuthMiddleware, optionalAuth } from 'hono-crud';

// Require one of JWT or API Key
app.use('/api/*', createAuthMiddleware({
  jwt: {
    secret: process.env.JWT_SECRET!,
    issuer: 'my-app',
  },
  apiKey: {
    header: 'X-API-Key',
  },
}));

// Optional auth: sets user if present, allows anonymous
app.use('/public/*', optionalAuth({
  jwt: { secret: process.env.JWT_SECRET! },
}));
```

---

## Guards

Guards are Hono middleware that check authorization after authentication.

### Role Guards

```typescript
import { requireRoles, requireAllRoles, requireAuthenticated } from 'hono-crud';

// Require at least one of the specified roles (OR)
app.use('/admin/*', requireRoles('admin', 'super-admin'));

// Require ALL of the specified roles (AND)
app.use('/super/*', requireAllRoles('admin', 'verified'));

// Require any authenticated user (no role check)
app.use('/api/*', requireAuthenticated());
```

### Permission Guards

```typescript
import { requirePermissions, requireAnyPermission } from 'hono-crud';

// Require ALL permissions
app.use('/users/*', requirePermissions('users:read', 'users:write'));

// Require at least one permission
app.use('/data/*', requireAnyPermission('data:read', 'data:admin'));
```

### Custom Guards

```typescript
import { requireAuth, requireOwnership, requireOwnershipOrRole } from 'hono-crud';

// Custom authorization check
app.use('/premium/*', requireAuth((user, ctx) => {
  return user.metadata?.subscription === 'premium';
}));

// Ownership check
app.use('/users/:id/*', requireOwnership((ctx) => ctx.req.param('id')));

// Owner OR admin
app.use('/posts/:id/*', requireOwnershipOrRole(
  async (ctx) => {
    const post = await db.posts.findFirst({ where: { id: ctx.req.param('id') } });
    return post?.authorId ?? '';
  },
  'admin'
));
```

### Guard Composition

```typescript
import { allOf, anyOf, denyAll, allowAll } from 'hono-crud';

// ALL guards must pass (AND)
app.use('/secure/*', allOf(
  requireRoles('admin'),
  requirePermissions('secure:access'),
  requireAuth((user) => user.metadata?.mfaEnabled === true)
));

// ANY guard must pass (OR)
app.use('/shared/*', anyOf(
  requireRoles('admin'),
  requireOwnership((ctx) => getResourceOwnerId(ctx)),
  requirePermissions('shared:access')
));

// Block a route entirely
app.use('/maintenance/*', denyAll('Service temporarily unavailable'));

// Explicitly mark as public
app.use('/public/*', allowAll());
```

### Guards with registerCrud

```typescript
import { registerCrud, requireAuthenticated, requireRoles } from 'hono-crud';

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
}, {
  // Applied to all endpoints
  middlewares: [requireAuthenticated()],
  // Applied to specific endpoints
  endpointMiddlewares: {
    create: [requireRoles('admin')],
    delete: [requireRoles('admin')],
  },
});
```

---

## better-auth Integration

[better-auth](https://www.better-auth.com) handles login, signup, OAuth, 2FA, and session management. hono-crud handles CRUD with authorization guards.

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth'; // your better-auth instance

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// CORS for auth routes
app.use('/api/auth/*', cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));

// Mount better-auth handler
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Session middleware: inject user into context
app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', session?.user ?? null);
  c.set('session', session?.session ?? null);
  await next();
});

// Protect CRUD routes
registerCrud(app, '/api/users', {
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
}, {
  middlewares: [requireAuthenticated()],
  endpointMiddlewares: {
    delete: [requireRoles('admin')],
  },
});
```

### Architecture

```
Request -> CORS -> Session Middleware -> Auth Guards -> CRUD Endpoint
                        |
                   better-auth
                 (validates session)
```
