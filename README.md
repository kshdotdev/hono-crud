# hono-crud

[![npm version](https://img.shields.io/npm/v/hono-crud.svg)](https://www.npmjs.com/package/hono-crud)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

Type-safe CRUD generator for [Hono](https://hono.dev) with Zod validation and automatic OpenAPI documentation.

## Features

- **Full CRUD Operations** - Generate Create, Read, Update, Delete, List endpoints with one call
- **OpenAPI/Swagger** - Auto-generated docs with Swagger UI, Scalar, and ReDoc
- **Database Adapters** - Memory (prototyping), Drizzle ORM, and Prisma
- **4 API Patterns** - Class-based, functional, builder, and config-based
- **Zod Validation** - Type-safe request/response validation
- **TypeScript First** - Full type inference and autocompletion
- **Edge Ready** - Works with Cloudflare Workers, Deno, Bun, and Node.js
- **Authentication** - JWT, API Key middleware with role/permission guards
- **Caching** - Response caching with automatic invalidation
- **Rate Limiting** - Fixed/sliding window with tier-based limits
- **Advanced Features** - Soft delete, relations, batch operations, search, versioning, audit logging, and more

## Installation

```bash
npm install hono-crud hono zod
```

Peer dependencies: `hono >= 4.0.0` and `zod >= 4.0.0` are required.

## Quick Start

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
} from 'hono-crud/adapters/memory';

// 1. Define your schema
const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
});

// 2. Create model + meta
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

// 3. Define endpoints
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role'];
  searchFields = ['name', 'email'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get a user' };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role'];
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Delete a user' };
}

// 4. Wire it up
const app = fromHono(new Hono());

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});

// 5. OpenAPI docs
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'My API', version: '1.0.0' },
});
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

export default app;
```

This generates:

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/users` | Create a user |
| `GET` | `/users` | List users (with filtering, search, pagination) |
| `GET` | `/users/:id` | Get a user by ID |
| `PATCH` | `/users/:id` | Update a user |
| `DELETE` | `/users/:id` | Delete a user |

## API Patterns

hono-crud supports four ways to define endpoints. All produce classes compatible with `registerCrud()` and can be mixed.

| Pattern | Best For | Style |
|---------|----------|-------|
| **Class-based** | Complex logic, database adapters | `class UserList extends MemoryListEndpoint { ... }` |
| **Functional** | Quick setup | `createList({ meta, filterFields: ['role'] }, MemoryListEndpoint)` |
| **Builder** | Readable chains | `crud(meta).list().filter('role').build(MemoryListEndpoint)` |
| **Config-based** | Declarative, all-in-one | `defineEndpoints({ meta, list: { ... } }, MemoryAdapters)` |

```typescript
import { createList, crud, defineEndpoints, MemoryAdapters } from 'hono-crud';

// Functional
const UserList = createList(
  { meta: userMeta, filterFields: ['role'], searchFields: ['name'] },
  MemoryListEndpoint
);

// Builder
const UserList = crud(userMeta)
  .list()
  .filter('role')
  .search('name')
  .pagination(20, 100)
  .build(MemoryListEndpoint);

// Config-based (all endpoints at once)
const endpoints = defineEndpoints({
  meta: userMeta,
  create: { openapi: { tags: ['Users'], summary: 'Create user' } },
  list: { filtering: { fields: ['role'] }, search: { fields: ['name'] } },
  read: {},
  update: { fields: { allowed: ['name', 'role'] } },
  delete: {},
}, MemoryAdapters);

registerCrud(app, '/users', endpoints);
```

See [docs/alternative-api-patterns.md](./docs/alternative-api-patterns.md) for the full reference.

## Database Adapters

### Memory

Zero-config, perfect for prototyping and tests:

```typescript
import { MemoryCreateEndpoint, MemoryListEndpoint /* ... */ } from 'hono-crud/adapters/memory';
```

### Drizzle

Use `createDrizzleCrud` for minimal boilerplate:

```typescript
import { createDrizzleCrud } from 'hono-crud/adapters/drizzle';
import { db } from './db';

const User = createDrizzleCrud(db, userMeta);

class UserCreate extends User.Create {
  schema = { tags: ['Users'], summary: 'Create user' };
}

class UserList extends User.List {
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role'];
}
```

Or set `db` directly on each endpoint class:

```typescript
import { DrizzleListEndpoint } from 'hono-crud/adapters/drizzle';

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = drizzleDb;
  filterFields = ['role'];
}
```

### Prisma

```typescript
import { PrismaListEndpoint } from 'hono-crud/adapters/prisma';

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prismaClient;
  filterFields = ['role'];
}
```

See [docs/database-adapters.md](./docs/database-adapters.md) for complete setup guides.

## Authentication

Built-in JWT and API Key middleware with composable guards:

```typescript
import { createJWTMiddleware, requireRoles, requireAuthenticated, anyOf } from 'hono-crud';

// JWT middleware
app.use('/api/*', createJWTMiddleware({
  secret: process.env.JWT_SECRET!,
  issuer: 'my-app',
}));

// Guards on specific endpoints
registerCrud(app, '/users', endpoints, {
  middlewares: [requireAuthenticated()],
  endpointMiddlewares: {
    delete: [requireRoles('admin')],
  },
});

// Composable guards
app.use('/admin/*', anyOf(
  requireRoles('admin'),
  requireOwnership((ctx) => ctx.req.param('id'))
));
```

See [docs/authentication.md](./docs/authentication.md) for JWT, API Key, guards, and better-auth integration.

## Middleware

### Caching

```typescript
import { withCache, withCacheInvalidation, setCacheStorage, MemoryCacheStorage } from 'hono-crud';

class UserRead extends withCache(MemoryReadEndpoint) {
  _meta = userMeta;
  cacheConfig = { ttl: 300, perUser: false };
}
```

See [docs/caching.md](./docs/caching.md).

### Rate Limiting

```typescript
import { createRateLimitMiddleware, setRateLimitStorage, MemoryRateLimitStorage } from 'hono-crud';

setRateLimitStorage(new MemoryRateLimitStorage());

app.use('/api/*', createRateLimitMiddleware({
  limit: 100,
  windowSeconds: 60,
  keyStrategy: 'ip',
}));
```

See [docs/rate-limiting.md](./docs/rate-limiting.md).

### Logging

```typescript
import { createLoggingMiddleware, setLoggingStorage, MemoryLoggingStorage } from 'hono-crud';

setLoggingStorage(new MemoryLoggingStorage());

app.use('*', createLoggingMiddleware({
  redactHeaders: ['authorization', 'cookie'],
  redactBodyFields: ['password'],
}));
```

See [docs/logging.md](./docs/logging.md).

## Advanced Features

- **Soft Delete & Restore** - `softDelete: true` in model, `?withDeleted=true`, restore endpoint
- **Relations** - `hasOne`, `hasMany`, `belongsTo` with `?include=posts,profile`
- **Nested Writes** - Create/update related records in a single request
- **Batch Operations** - Batch create, update, delete, restore, upsert
- **Upsert** - Create or update by unique keys
- **Versioning** - Record version history with rollback
- **Audit Logging** - Track who changed what and when
- **Full-Text Search** - Weighted search with highlighting
- **Aggregation** - Sum, count, avg, min, max with grouping
- **Export/Import** - CSV and JSON export/import
- **Computed Fields** - Virtual fields calculated on read
- **Field Selection** - `?fields=id,name,email`
- **Events & Webhooks** - Event emitter with webhook delivery
- **Encryption** - Field-level encryption with Web Crypto API
- **Idempotency** - Idempotency key middleware for safe retries
- **Multi-Tenancy** - Tenant isolation via header, path, query, or JWT
- **Health Checks** - Liveness and readiness endpoints
- **Error Handling** - Typed exceptions with custom error handlers

See [docs/advanced-features.md](./docs/advanced-features.md) for examples of every feature.

## API Documentation

```typescript
import { setupSwaggerUI, setupReDoc, setupScalar } from 'hono-crud';

// OpenAPI spec
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'My API', version: '1.0.0' },
});

// Documentation UIs
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
setupReDoc(app, { redocPath: '/redoc', specPath: '/openapi.json' });
setupScalar(app, '/reference', { specUrl: '/openapi.json' });
```

## Examples

See the [examples/](./examples) directory for complete working applications:

- [Memory Adapter](./examples/memory) - Basic CRUD, alternative APIs, comprehensive features
- [Drizzle + PostgreSQL](./examples/drizzle) - Schema, relations, filtering, batch operations
- [Prisma + PostgreSQL](./examples/prisma) - Schema, relations, filtering, batch operations

## Requirements

- Node.js >= 20
- TypeScript >= 5.0

## License

[MIT](./LICENSE) - Kauan Guesser
