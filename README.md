<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo.svg">
  <img src="logo-dark.svg" alt="hono-crud" width="124" height="124">
</picture>

# hono-crud

**Type-safe CRUD generator for [Hono](https://hono.dev) — Zod validation, automatic OpenAPI docs,<br>and an edge-ready feature set, all from a single model definition.**

[![npm version](https://img.shields.io/npm/v/hono-crud?color=ff5b11&label=npm)](https://www.npmjs.com/package/hono-crud)
[![npm downloads](https://img.shields.io/npm/dm/hono-crud?color=ff5b11&label=downloads)](https://www.npmjs.com/package/hono-crud)
[![tests](https://img.shields.io/github/actions/workflow/status/kshdotdev/hono-crud/ci.yml?branch=main&label=tests)](https://github.com/kshdotdev/hono-crud/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/hono-crud)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/hono-crud?color=blue)](https://opensource.org/licenses/MIT)

</div>

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
- **MCP for AI Agents** - Expose your CRUD resources as Model Context Protocol tools, callable by Claude, Cursor, and any MCP client
- **Advanced Features** - Soft delete, relations, batch operations, search, versioning, audit logging, and more

## Installation

Install the core package plus the adapter you need (and Swagger UI, if you want docs):

```bash
npm install hono-crud @hono-crud/memory @hono-crud/swagger hono zod
```

Peer dependencies: `hono >= 4.0.0` and `zod >= 4.0.0` are required.

## Packages

`hono-crud` is published as a small core plus focused add-on packages, so you only install what you use:

| Package | Purpose |
|---|---|
| `hono-crud` | Core: `defineModel`, `registerCrud`, `fromHono`, endpoint classes, auth, logging, events, encryption, serialization, audit, versioning, multi-tenant, api-version |
| `@hono-crud/memory` | In-memory CRUD adapter (tests, demos) |
| `@hono-crud/drizzle` | Drizzle ORM CRUD adapter |
| `@hono-crud/prisma` | Prisma CRUD adapter |
| `@hono-crud/swagger` | Swagger UI + ReDoc documentation endpoints |
| `@hono-crud/scalar` | Scalar API reference documentation endpoint |
| `@hono-crud/cache` | Caching mixins and storage backends |
| `@hono-crud/rate-limit` | Rate limiting middleware and storage backends |
| `@hono-crud/idempotency` | Idempotency middleware and storage backends |
| `@hono-crud/health` | Health check endpoints |
| `@hono-crud/mcp` | Expose your CRUD resources as Model Context Protocol (MCP) tools for AI agents |

## Quick Start

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import { setupSwaggerUI } from '@hono-crud/swagger';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
} from '@hono-crud/memory';

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
import { createList, crud, defineEndpoints } from 'hono-crud';
import { MemoryAdapters } from '@hono-crud/memory';

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

Zero-config, perfect for prototyping and tests (`npm install @hono-crud/memory`):

```typescript
import { MemoryCreateEndpoint, MemoryListEndpoint /* ... */ } from '@hono-crud/memory';
```

### Drizzle

`npm install @hono-crud/drizzle drizzle-orm drizzle-zod`. Use `createDrizzleCrud` for minimal boilerplate:

```typescript
import { createDrizzleCrud } from '@hono-crud/drizzle';
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
import { DrizzleListEndpoint } from '@hono-crud/drizzle';

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = drizzleDb;
  filterFields = ['role'];
}
```

### Prisma

`npm install @hono-crud/prisma @prisma/client pluralize fastest-levenshtein`:

```typescript
import { PrismaListEndpoint } from '@hono-crud/prisma';

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
import { withCache, withCacheInvalidation, setCacheStorage, MemoryCacheStorage } from '@hono-crud/cache';
import { MemoryReadEndpoint } from '@hono-crud/memory';

class UserRead extends withCache(MemoryReadEndpoint) {
  _meta = userMeta;
  cacheConfig = { ttl: 300, perUser: false };
}
```

See [docs/caching.md](./docs/caching.md).

### Rate Limiting

```typescript
import { createRateLimitMiddleware, setRateLimitStorage, MemoryRateLimitStorage } from '@hono-crud/rate-limit';

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

### MCP (AI agents)

Expose the CRUD resources you already register as [Model Context Protocol](https://modelcontextprotocol.io) tools (`npm install @hono-crud/mcp @modelcontextprotocol/sdk`). Tool calls are re-dispatched through the same Hono app, so they run the identical pipeline — auth, validation, hooks, serialization — as your REST API.

```typescript
import { createCrudMcp } from '@hono-crud/mcp';

const mcp = createCrudMcp(app, { name: 'my-api', version: '1.0.0' });
mcp.resource('/users', userEndpoints); // or: createCrudMcp(app, { ..., auto: true })
app.all('/mcp', mcp.handler());
```

This generates `users_list`, `users_read`, `users_create`, `users_update`, and `users_delete` tools, each with an input schema derived from the endpoint's Zod schema. See [docs/mcp.md](./docs/mcp.md).

## Response shape

Every CRUD endpoint defaults to a small, predictable response envelope so consumers always know where to find `result` and `error`:

```jsonc
// Success — single item (Create / Read / Update / Restore / Upsert / Clone / …)
{ "success": true, "result": { "id": "…", … } }

// Success — list / search (with pagination metadata)
{ "success": true, "result": [ … ], "result_info": { "page": 1, "per_page": 20, … } }

// Error — produced by `ApiException`s thrown from the endpoint or by
// `createErrorHandler` for everything else
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "details": … } }
```

### Pluggable envelope (`responseEnvelope`)

If your house API standard prefers a different shape — RFC 7807 Problem Details, JSON:API `{ data, meta }`, or any custom envelope — pass `responseEnvelope` to `registerCrud`. The two functions are the **final formatting step** before the response body is serialised:

```typescript
import { registerCrud, type ResponseEnvelope } from 'hono-crud';

const envelope: ResponseEnvelope = {
  success: (result, info) =>
    info ? { data: result, meta: info } : { data: result },
  error: (err) => ({
    errors: [{ status: err.code, title: err.message, source: err.details }],
  }),
};

registerCrud(app, '/users', endpoints, { responseEnvelope: envelope });
```

The `info` argument is the pagination metadata for list/search responses; it's `undefined` for single-item responses, so a single envelope works across the whole CRUD surface.

### Composition with `createErrorHandler`

For errors, the envelope composes with the existing `mappers` chain on `createErrorHandler`. The order is fixed:

1. `mappers[]` (and the built-in `zodErrorMapper`) transform the raw `Error` into a structured `ApiException` (`{ code, message, details? }`).
2. `responseEnvelope.error(...)` wraps that structured object into the final response body.

```typescript
import { createErrorHandler, type ErrorMapper } from 'hono-crud';

const prismaMapper: ErrorMapper = (err) => {
  if ((err as { code?: string }).code === 'P2002') {
    return new ConflictException('Duplicate key', { /* … */ });
  }
};

app.onError(createErrorHandler({
  mappers: [prismaMapper],
  // Handler-level default — applies to errors that propagate to onError
  // (i.e. anything that's not already an ApiException). Per-route envelope
  // set via `registerCrud({ responseEnvelope })` always wins.
  responseEnvelope: envelope,
}));
```

This split lets you keep your domain-error mappers (Prisma codes, Drizzle constraint violations, …) unchanged and layer a custom shape on top — no response-rewriting middleware required.

When `responseEnvelope` is omitted (the default), the response body is byte-identical to pre-0.10.0 — existing consumers see no behaviour change.

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

### Subpath Imports

Several core features are also exposed as tree-shakeable subpaths, so apps that only need one feature can import it directly without pulling in the rest of the library:

```typescript
import { multiTenant } from 'hono-crud/multi-tenant';
import { createAuditLogger, MemoryAuditLogStorage } from 'hono-crud/audit';
import { VersionManager, MemoryVersioningStorage } from 'hono-crud/versioning';
import { CrudEventEmitter, registerWebhooks } from 'hono-crud/events';
import { encryptFields, decryptFields, StaticKeyProvider } from 'hono-crud/encryption';
import { applyProfile, type SerializationProfile } from 'hono-crud/serialization';
import { apiVersion, getApiVersion } from 'hono-crud/api-version';
```

These symbols also remain available from the `'hono-crud'` barrel for convenience.

Idempotency and health checks ship as their own packages:

```typescript
import { idempotency, MemoryIdempotencyStorage } from '@hono-crud/idempotency';
import { createHealthEndpoints } from '@hono-crud/health';
```

## API Documentation

`npm install @hono-crud/swagger @hono-crud/scalar`:

```typescript
import { setupSwaggerUI, setupReDoc } from '@hono-crud/swagger';
import { setupScalar } from '@hono-crud/scalar';

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
