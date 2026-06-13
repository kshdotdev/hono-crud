# Advanced Features

This document covers all advanced hono-crud features with code examples.

The samples below share this setup — an in-memory `users` resource:

<!-- docs-typecheck:prelude -->
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
} from '@hono-crud/memory';

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(['admin', 'user']),
  status: z.string(),
  age: z.number(),
  createdAt: z.string(),
  deletedAt: z.date().nullable().optional(),
});

const userMeta = defineMeta({
  model: defineModel({
    tableName: 'users',
    schema: UserSchema,
    primaryKeys: ['id'],
  }),
});

const app = fromHono(new Hono());
```

---

## Soft Delete & Restore

Mark records as deleted instead of removing them. Requires a `deletedAt` field in your schema (see `UserSchema` above).

```typescript
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema, // includes `deletedAt: z.date().nullable().optional()`
  primaryKeys: ['id'],
  softDelete: true,
  // Or with custom config:
  // softDelete: {
  //   field: 'deletedAt',
  //   allowQueryDeleted: true,
  //   queryParam: 'withDeleted',
  // },
});
```

**Query parameters:**
- `?withDeleted=true` - Include soft-deleted records
- `?onlyDeleted=true` - Show only soft-deleted records

**Restore endpoint:**

```typescript
import { MemoryRestoreEndpoint } from '@hono-crud/memory';

class UserRestore extends MemoryRestoreEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

registerCrud(app, '/users', {
  // ...other endpoints
  restore: UserRestore,
});
// Registers: POST /users/:id/restore
```

---

## Relations

Define relationships between models and load them with `?include=`.

```typescript
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
    profile: { type: 'hasOne', model: 'profiles', foreignKey: 'userId' },
    comments: { type: 'hasMany', model: 'comments', foreignKey: 'authorId' },
  },
});

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.uuid(),
});

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  relations: {
    author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'id' },
    comments: { type: 'hasMany', model: 'comments', foreignKey: 'postId' },
  },
});
```

**Enable on endpoints:**

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  allowedIncludes = ['posts', 'profile'];
}
```

**Query:**
```
GET /users?include=posts,profile
GET /users/123?include=posts
```

### Relation Types

| Type | Description | Example |
|------|-------------|---------|
| `hasOne` | One-to-one (parent side) | User has one Profile |
| `hasMany` | One-to-many (parent side) | User has many Posts |
| `belongsTo` | Many-to-one (child side) | Post belongs to User |

---

## Nested Writes

Create or update related records in a single request.

```typescript
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  allowNestedCreate = ['profile', 'posts'];
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  allowNestedWrites = ['profile'];
}
```

**Request:**
```json
POST /users
{
  "name": "Alice",
  "email": "alice@example.com",
  "profile": {
    "bio": "Developer",
    "avatar": "https://example.com/alice.jpg"
  },
  "posts": [
    { "title": "Hello World", "content": "My first post" }
  ]
}
```

---

## Batch Operations

Process multiple records in a single request.

```typescript
import {
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
} from '@hono-crud/memory';

class UserBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch create users' };
  maxBatchSize = 100;
}

class UserBatchUpdate extends MemoryBatchUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch update users' };
  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role'];
}

class UserBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch delete users' };
  maxBatchSize = 100;
}

class UserBatchRestore extends MemoryBatchRestoreEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Batch restore users' };
  maxBatchSize = 100;
}

registerCrud(app, '/users', {
  // ...standard endpoints
  batchCreate: UserBatchCreate,
  batchUpdate: UserBatchUpdate,
  batchDelete: UserBatchDelete,
  batchRestore: UserBatchRestore,
});
```

**Endpoints generated:**
- `POST /users/batch` - Batch create
- `PATCH /users/batch` - Batch update
- `DELETE /users/batch` - Batch delete
- `POST /users/batch/restore` - Batch restore

**Batch create request:**
```json
POST /users/batch
{
  "items": [
    { "name": "Alice", "email": "alice@example.com", "role": "admin" },
    { "name": "Bob", "email": "bob@example.com", "role": "user" }
  ]
}
```

**Batch update request:**
```json
PATCH /users/batch
{
  "items": [
    { "id": "uuid-1", "data": { "role": "admin" } },
    { "id": "uuid-2", "data": { "role": "user" } }
  ]
}
```

---

## Upsert

Create or update a record based on unique keys.

```typescript
import { MemoryUpsertEndpoint } from '@hono-crud/memory';

const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  sortOrder: z.number(),
});

const categoryMeta = defineMeta({
  model: defineModel({
    tableName: 'categories',
    schema: CategorySchema,
    primaryKeys: ['id'],
  }),
});

class CategoryUpsert extends MemoryUpsertEndpoint {
  _meta = categoryMeta;
  schema = { tags: ['Categories'], summary: 'Upsert a category' };
  upsertKeys = ['name']; // Match on these fields
}

registerCrud(app, '/categories', {
  upsert: CategoryUpsert,
});
// Registers: POST /categories/upsert
```

**Request:**
```json
POST /categories/upsert
{ "name": "Technology", "description": "Tech posts", "sortOrder": 1 }
```

If a category with `name: "Technology"` exists, it's updated. Otherwise, it's created.

---

## Versioning

Track record version history with rollback support.

```typescript
import { MemoryVersioningStorage } from 'hono-crud/versioning';
import { createStorageMiddleware } from 'hono-crud/storage';

// Setup storage (recommended: per-request injection, edge-safe; on a
// long-lived server, `setVersioningStorage()` once is the alternative)
app.use('*', createStorageMiddleware({
  versioningStorage: new MemoryVersioningStorage(),
}));

// Enable in model
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  versioning: true,
  // Or: versioning: { maxVersions: 50, trackChangedBy: true }
});
```

**Version endpoints** (each adapter package ships its own variants — shown here for `@hono-crud/memory`):

```typescript
import {
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionRollbackEndpoint,
} from '@hono-crud/memory';

class UserVersionHistory extends MemoryVersionHistoryEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Version history' };
}

class UserVersionRead extends MemoryVersionReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Read specific version' };
}

class UserVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Compare versions' };
}

class UserVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Rollback to version' };
}

registerCrud(app, '/users', {
  versionHistory: UserVersionHistory,
  versionRead: UserVersionRead,
  versionCompare: UserVersionCompare,
  versionRollback: UserVersionRollback,
});
// Registers:
//   GET  /users/:id/versions
//   GET  /users/:id/versions/compare
//   GET  /users/:id/versions/:version
//   POST /users/:id/versions/:version/rollback
```

---

## Audit Logging

Track who changed what and when.

```typescript
import { MemoryAuditLogStorage } from 'hono-crud/audit';
import { createStorageMiddleware } from 'hono-crud/storage';

// Setup storage (recommended: per-request injection, edge-safe; on a
// long-lived server, `setAuditStorage()` once is the alternative)
app.use('*', createStorageMiddleware({
  auditStorage: new MemoryAuditLogStorage(),
}));

// Enable in model
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  audit: true,
  // Or: audit: { trackChanges: true, excludeFields: ['password'] }
});
```

Audit entries include: action type, table, record ID, user ID, timestamp, and optionally the field-level changes.

---

## Full-Text Search

Weighted search with highlighting across multiple fields.

```typescript
import { MemorySearchEndpoint } from '@hono-crud/memory';

class UserSearch extends MemorySearchEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Search users' };
  searchFields = ['name', 'email'];
}

registerCrud(app, '/users', {
  search: UserSearch,
});
// Registers: GET /users/search
```

**Query:**
```
GET /users/search?q=alice&fields=name,email&highlight=true
```

For list endpoints, use `searchFields`:

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  searchFields = ['name', 'email'];
}

// Query: GET /users?search=alice
```

---

## Aggregation

Compute sum, count, avg, min, max with grouping.

```typescript
import { MemoryAggregateEndpoint } from '@hono-crud/memory';

class UserAggregate extends MemoryAggregateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Aggregate user data' };
}

registerCrud(app, '/users', {
  aggregate: UserAggregate,
});
// Registers: GET /users/aggregate
```

**Query** (one query param per operation: `count`, `sum`, `avg`, `min`, `max`, `countDistinct`):
```
GET /users/aggregate?count=id&avg=age&groupBy=role
```

---

## Export / Import

Export and import records as CSV or JSON.

```typescript
import { MemoryExportEndpoint, MemoryImportEndpoint } from '@hono-crud/memory';

class UserExport extends MemoryExportEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Export users' };
}

class UserImport extends MemoryImportEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Import users' };
}

registerCrud(app, '/users', {
  export: UserExport,
  import: UserImport,
});
// Registers: GET /users/export and POST /users/import
```

**Export:**
```
GET /users/export?format=csv
GET /users/export?format=json&fields=id,name,email
```

**Import modes** (`?mode=`):
- `create` - Create new records only (fails on duplicates)
- `upsert` - Create or update (matched by `upsertKeys`)

---

## Computed Fields

Virtual fields calculated at runtime, not stored in the database. Each entry
(`ComputedFieldConfig`) takes a `compute` function, an optional Zod `schema`
(for OpenAPI documentation), and an optional `dependsOn` list used to skip
computation when none of those fields were selected.

```typescript
const PersonSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string(),
  status: z.string(),
  emailVerified: z.boolean(),
});

const PersonModel = defineModel({
  tableName: 'people',
  schema: PersonSchema,
  primaryKeys: ['id'],
  computedFields: {
    fullName: {
      schema: z.string(),
      dependsOn: ['firstName', 'lastName'],
      compute: (record) => `${record.firstName} ${record.lastName}`,
    },
    age: {
      schema: z.number(),
      dependsOn: ['birthDate'],
      compute: (record) => {
        const birth = new Date(record.birthDate);
        const today = new Date();
        return today.getFullYear() - birth.getFullYear();
      },
    },
    isActive: {
      schema: z.boolean(),
      compute: (record) => record.status === 'active' && record.emailVerified,
    },
  },
});
```

Computed fields are automatically included in read/list responses.

---

## Field Selection

Allow clients to select which fields to return.

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  fieldSelectionEnabled = true;
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  fieldSelectionEnabled = true;
}
```

**Query:**
```
GET /users?fields=id,name,email
GET /users/123?fields=id,name
```

---

## Events & Webhooks

Event emitter for CRUD operations with webhook delivery.

### Event Emitter

```typescript
import { CrudEventEmitter } from 'hono-crud/events';
import { createStorageMiddleware } from 'hono-crud/storage';

// Inject per-request (recommended on edge runtimes; `setEventEmitter()` is the
// long-lived-server compatibility option)
const events = new CrudEventEmitter();
app.use('*', createStorageMiddleware({ eventEmitter: events }));

// Subscribe to specific events
events.on('users', 'created', (event) => {
  console.log('User created:', event.recordId);
});

// Subscribe to all events on a table
events.onTable('users', (event) => {
  console.log(`User ${event.type}:`, event.recordId);
});

// Subscribe to all events
events.onAny((event) => {
  console.log(`${event.type} on ${event.table}:`, event.recordId);
});
```

### Webhooks

```typescript
import { CrudEventEmitter, registerWebhooks } from 'hono-crud/events';
import { createStorageMiddleware } from 'hono-crud/storage';

const events = new CrudEventEmitter();
app.use('*', createStorageMiddleware({ eventEmitter: events }));

// Webhook signing secret — load from your secret store
// (e.g. `env()` from 'hono/adapter')
declare const WEBHOOK_SECRET: string;

registerWebhooks({
  emitter: events,
  endpoints: [
    {
      url: 'https://hooks.example.com/crud',
      secret: WEBHOOK_SECRET,
      events: ['users:created', 'users:updated'],
      retries: 2,
      timeoutMs: 10000,
    },
  ],
});
```

Webhooks are signed with HMAC-SHA256 using the Web Crypto API (edge-safe). The signature is included in the `X-Webhook-Signature` header.

---

## Encryption

Field-level encryption using AES-GCM via the Web Crypto API. Configure it once
on the model (`fieldEncryption`, a `FieldEncryptionConfig`) and endpoints
encrypt the listed fields before create/update writes and decrypt them after
read/list reads automatically. For lower-level control, call
`encryptFields` / `decryptFields` yourself in lifecycle hooks.

```typescript
import {
  decryptFields,
  encryptFields,
  StaticKeyProvider,
} from 'hono-crud/encryption';
import type { HookContext } from 'hono-crud';

// 256-bit key, base64-encoded — load from your secret store (e.g. `env()`
// from 'hono/adapter'); `StaticKeyProvider.generateKey()` makes one for dev.
declare const ENCRYPTION_KEY_BASE64: string;

const keyProvider = new StaticKeyProvider(ENCRYPTION_KEY_BASE64);

// Model-level config: encrypt/decrypt happens automatically in endpoints
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  fieldEncryption: {
    fields: ['ssn', 'creditCard'],
    keyProvider,
  },
});

// Lower-level alternative: encrypt/decrypt yourself in hooks
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  override async before(data: Record<string, unknown>, hookCtx: HookContext) {
    return encryptFields(data, ['ssn', 'creditCard'], keyProvider);
  }
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  override async after(record: Record<string, unknown>) {
    return decryptFields(record, ['ssn', 'creditCard'], keyProvider);
  }
}
```

---

## Idempotency

Prevent duplicate operations via idempotency keys.

```typescript
import {
  createIdempotencyMiddleware,
  MemoryIdempotencyStorage,
} from '@hono-crud/idempotency';
import { createStorageMiddleware } from 'hono-crud/storage';

// Wire storage (recommended: per-request injection, edge-safe)
app.use('*', createStorageMiddleware({
  idempotencyStorage: new MemoryIdempotencyStorage(),
}));

// Apply to mutation endpoints
app.use('/api/*', createIdempotencyMiddleware({
  headerName: 'Idempotency-Key',  // default
  ttlSeconds: 86400,               // 24 hours (default)
}));
```

Clients include `Idempotency-Key: <unique-key>` in the request header. If the same key is seen again within the TTL, the cached response is returned.

For production use `RedisIdempotencyStorage` (Upstash works on edge runtimes) —
`MemoryIdempotencyStorage` is per-isolate, so it cannot guarantee replay
protection across instances. There is deliberately no Cloudflare KV backend:
KV lacks compare-and-swap, so the in-flight lock cannot be made atomic (see the
[package README](../packages/idempotency/README.md)).

### Global Storage (long-lived servers)

On a long-lived Node/Bun server you can set a module-global storage once
instead. Resolution priority is explicit `config.storage` > context > global:

```typescript
import { setIdempotencyStorage, MemoryIdempotencyStorage } from '@hono-crud/idempotency';

setIdempotencyStorage(new MemoryIdempotencyStorage());
```

### Accessors

- `getIdempotencyStorage()` returns the explicitly-configured storage or
  `null` (it no longer throws). Use it when an unconfigured store is an
  acceptable, handled case.
- `getIdempotencyStorageRequired()` throws when no storage is configured — this
  is the old throwing behavior of `getIdempotencyStorage()`.
- `resolveIdempotencyStorage(ctx, explicit?)` applies the
  explicit &gt; context &gt; global priority chain and never creates a default.

---

## Multi-Tenancy

Isolate data by tenant using header, path, query, or JWT extraction.

```typescript
import { multiTenant } from 'hono-crud/multi-tenant';

// Extract tenant from header (default)
app.use('/api/*', multiTenant({
  source: 'header',
  headerName: 'X-Tenant-ID',  // default
  required: true,               // 400 TENANT_REQUIRED if missing
}));

// Extract from JWT claims
app.use('/api/*', multiTenant({
  source: 'jwt',
  jwtClaim: 'tenantId',
}));

// Extract from path
app.use('/api/:tenantId/*', multiTenant({
  source: 'path',
  pathParam: 'tenantId',
}));

// Custom extraction
app.use('/api/*', multiTenant({
  source: 'custom',
  extractor: (ctx) => ctx.req.header('X-Org-ID'),
}));
```

**Error codes:** denials use the canonical error envelope. A missing tenant ID
with `required: true` (the default) throws 400 `TENANT_REQUIRED` (message
configurable via `errorMessage`); a tenant rejected by your `validate()`
function throws 400 `INVALID_TENANT` (message configurable via
`invalidMessage`). Pass `onMissing` to return a fully custom `Response`
instead, or `required: false` to continue without a tenant.

**Model-level config:**

Multi-tenancy is a two-stage pipeline. Stage 1 is the `multiTenant()`
middleware above: it extracts the tenant ID from the request (header, path,
query, JWT, or custom), enforces `required`/`validate`, and publishes the
value to a context variable (`contextKey`, default `'tenantId'`). Stage 2 is
the model-level config: with `source: 'context'` (the default) the data layer
reads exactly what the middleware published, then filters every query by
`field` and injects it on create.

```typescript
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  multiTenant: {
    field: 'tenantId',        // column that stores the tenant ID (default 'tenantId')
    source: 'context',        // 'context' (default) | 'header' | 'path' | 'custom'
    contextKey: 'tenantId',   // context var the data layer READS (middleware WRITES it)
    headerName: 'X-Tenant-ID',// used when source is 'header'
    pathParam: 'tenantId',    // used when source is 'path'
    // getTenantId: (ctx) => ..., // custom extractor when source is 'custom'
    required: true,           // false = silently return no results when missing
    errorMessage: 'Tenant ID is required',
  },
});
```

---

## Health Checks

Liveness and readiness endpoints.

```typescript
import { createHealthRoutes } from 'hono-crud/health';

// your own connections
declare const db: { execute(sql: string): Promise<unknown> };
declare const redis: { ping(): Promise<string> };

app.route('/', createHealthRoutes({
  version: '1.0.0',
  path: '/health',       // Liveness (always 200)
  readyPath: '/ready',   // Readiness (runs checks)
  checks: [
    {
      name: 'database',
      check: async () => { await db.execute('SELECT 1'); },
      critical: true,    // Failure = 503 (default)
    },
    {
      name: 'cache',
      check: async () => { await redis.ping(); },
      critical: false,   // Failure = degraded, not unhealthy
      timeoutMs: 3000,   // Per-check timeout
    },
  ],
}));
```

**Response:**
```json
{
  "status": "healthy",
  "checks": [
    { "name": "database", "healthy": true, "latency": 12 },
    { "name": "cache", "healthy": true, "latency": 3 }
  ],
  "latency": 15,
  "version": "1.0.0",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Error Handling

### Built-in Exceptions

```typescript
import {
  ApiException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  InputValidationException,
} from 'hono-crud';

// your own lookup
declare function findByEmail(email: unknown): Promise<Record<string, unknown> | null>;

// Throw in endpoint hooks
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  override async before(data: Record<string, unknown>) {
    const existing = await findByEmail(data.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }
    return data;
  }
}
```

### Custom Error Handler

```typescript
import { createErrorHandler } from 'hono-crud';

const errorHandler = createErrorHandler({
  defaultErrorCode: 'INTERNAL_ERROR', // code for unmapped errors (default)
  defaultErrorMessage: 'An internal error occurred', // message for unmapped errors (default)
  includeStackTrace: false, // dev-only escape hatch — never enable in production
});

app.onError(errorHandler);
```

Unmapped errors become a 500 with `defaultErrorCode` / `defaultErrorMessage`. Raw
`ZodError`s are always mapped to 400 `VALIDATION_ERROR` by the built-in
`zodErrorMapper` — you don't need to pass it. Thrown `ApiException`s serialize to
the canonical envelope even without this handler; wiring it is what extends the
uniform shape to everything else and adds `requestId` enrichment.

### Exception Types

| Exception | Status | Code | Use Case |
|-----------|--------|------|----------|
| `ApiException` | configurable | configurable (default `INTERNAL_ERROR`) | Base exception class |
| `NotFoundException` | 404 | `NOT_FOUND` | Resource not found |
| `ConflictException` | 409 | `CONFLICT` | Duplicate resource |
| `UnauthorizedException` | 401 | `UNAUTHORIZED` | Authentication required |
| `ForbiddenException` | 403 | `FORBIDDEN` | Insufficient permissions (including write-policy denials) |
| `InputValidationException` | 400 | `VALIDATION_ERROR` | Zod schema validation failures |
| `AggregationException` | 400 | `AGGREGATION_ERROR` | Aggregation allow-list / limit denials |
| `CacheException` | 500 | `CACHE_ERROR` | Cache operation failure |
| `ConfigurationException` | 500 | `CONFIGURATION_ERROR` | Invalid configuration |
| `RateLimitExceededException` (from `@hono-crud/rate-limit`) | 429 | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |

### Stable Error Codes

Some failures are emitted as plain `ApiException`s (or sanctioned short-circuit
responses) with stable codes rather than dedicated classes:

| Code | Status | When |
|------|--------|------|
| `TENANT_REQUIRED` | 400 | Multi-tenancy: required tenant ID is missing |
| `INVALID_TENANT` | 400 | Multi-tenancy: the configured `validate()` rejected the tenant |
| `INVALID_QUERY` | 400 | Search: query shorter than `minQueryLength` |
| `EMPTY_BODY` | 400 | Bulk patch: empty request body |
| `BULK_TOO_LARGE` | 400 | Bulk patch: matched records exceed `maxBulkSize` |
| `CONFIRMATION_REQUIRED` | 400 | Bulk patch: matched records ≥ `confirmThreshold` without the `X-Confirm-Bulk: true` header |
| `EVENT_EMITTER_NOT_CONFIGURED` | 500 | SSE subscribe: no event emitter configured |
| `TOO_MANY_CONNECTIONS` | 503 | SSE subscribe: max concurrent connections reached |
| `HTTP_ERROR` | varies | Third-party or Hono-internal `HTTPException`s (e.g. malformed JSON bodies) flattened by `createErrorHandler` — no library code path produces it |

---

## Filtering

List endpoints support advanced filtering operators.

### Simple Filters

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  filterFields = ['role', 'status']; // Equality filters
}

// GET /users?role=admin&status=active
```

### Advanced Filters

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  filterConfig = {
    age: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'null'] as const,
    name: ['eq', 'like', 'ilike'] as const,
    email: ['eq', 'like', 'ilike'] as const,
  };
}
```

**Query syntax:**
```
GET /users?age[gte]=18
GET /users?age[between]=18,30
GET /users?name[ilike]=alice
GET /users?role[in]=admin,user
GET /users?age[null]=true
```

### Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equal (default) | `?role=admin` or `?role[eq]=admin` |
| `ne` | Not equal | `?status[ne]=inactive` |
| `gt` | Greater than | `?age[gt]=18` |
| `gte` | Greater than or equal | `?age[gte]=18` |
| `lt` | Less than | `?age[lt]=65` |
| `lte` | Less than or equal | `?age[lte]=65` |
| `like` | Substring match (case behavior follows the DB collation; case-sensitive in memory) | `?name[like]=alice` |
| `ilike` | Substring match (always case-insensitive) | `?name[ilike]=alice` |
| `in` | In list | `?role[in]=admin,user` |
| `nin` | Not in list | `?role[nin]=admin,user` |
| `between` | Between two values | `?age[between]=18,30` |
| `null` | Is null / is not null | `?age[null]=true` |

`like`/`ilike` values are literal needles: `%` is stripped and `_` is inert —
they are never live SQL wildcards.

---

## Sorting & Pagination

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  sortFields = ['name', 'createdAt', 'age'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };
  defaultPerPage = 20;
  maxPerPage = 100;
}
```

**Query:**
```
GET /users?order_by=name&order_by_direction=asc
GET /users?page=2&per_page=50
```

**Response includes pagination metadata** (nested under `result_info`; with
cursor pagination it carries a `next_cursor` instead of page counts — cursor
walks are next-only, there is no `prev_cursor`):
```json
{
  "success": true,
  "result": [...],
  "result_info": {
    "page": 2,
    "per_page": 50,
    "total_count": 150,
    "total_pages": 3,
    "has_next_page": true,
    "has_prev_page": true
  }
}
```

---

## API Versioning

Negotiate the API version per request and transform responses per version.
Registration order matters: `apiVersion()` first, then `apiVersionedResponse()`,
then your route handlers — `apiVersionedResponse()` wraps handlers via
`await next()`, and middleware registered after a response-producing handler
never runs.

```typescript
import { apiVersion, apiVersionedResponse, getApiVersion, getApiVersionConfig } from 'hono-crud/api-version';

declare const userData: Record<string, unknown>; // your record

app.use('/api/*', apiVersion({
  versions: [
    { version: '1', responseTransformer: (data) => ({ id: data.id, name: data.name }) },
    { version: '2' },
  ],
  defaultVersion: '2',        // falls back to the first entry when omitted
  strategy: 'header',         // 'url' | 'header' | 'query' (default 'header')
  headerName: 'Accept-Version', // default
  queryParam: 'version',      // for strategy 'query' (default)
  urlPattern: '/v{version}',  // for strategy 'url' (default)
  extractVersion: undefined,  // custom extractor (overrides strategy)
  addHeaders: true,           // adds version response headers (default)
}));

// Rewrites response JSON through the active version's responseTransformer.
app.use('/api/*', apiVersionedResponse());

app.get('/api/users/:id', (c) => {
  const version = getApiVersion(c);          // e.g. '1'
  const config = getApiVersionConfig(c);     // the matched ApiVersionConfig entry
  return c.json(userData);                   // transformed on the way out for v1 clients
});
```

Each entry in `versions` is an `ApiVersionConfig` (`version`, optional
`middleware`, `requestTransformer`, `responseTransformer`, `deprecated`,
`sunset`).

---

## Serialization Profiles

Transform response data based on context (e.g., public vs admin views).

```typescript
import { applyProfile, type SerializationProfile } from 'hono-crud/serialization';
import { hasRole } from 'hono-crud/auth';

const publicProfile: SerializationProfile = {
  name: 'public',
  include: ['id', 'name', 'avatar'],
  exclude: ['email', 'role', 'createdAt'],
};

const adminProfile: SerializationProfile = {
  name: 'admin',
  include: ['id', 'name', 'email', 'role', 'createdAt'],
};

// Apply in endpoint
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  override async after(record: Record<string, unknown>) {
    const profile = hasRole(this.getContext(), 'admin') ? adminProfile : publicProfile;
    return applyProfile(record, profile);
  }
}
```
