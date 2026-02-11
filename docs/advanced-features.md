# Advanced Features

This document covers all advanced hono-crud features with code examples.

---

## Soft Delete & Restore

Mark records as deleted instead of removing them. Requires a `deletedAt` field in your schema.

```typescript
const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  deletedAt: z.date().nullable().optional(),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
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
import { MemoryRestoreEndpoint } from 'hono-crud/adapters/memory';

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
} from 'hono-crud/adapters/memory';

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
import { MemoryUpsertEndpoint } from 'hono-crud/adapters/memory';

class CategoryUpsert extends MemoryUpsertEndpoint {
  _meta = categoryMeta;
  schema = { tags: ['Categories'], summary: 'Upsert a category' };
  upsertKeys = ['name']; // Match on these fields
}

// Register manually (not part of standard CRUD)
app.put('/categories', CategoryUpsert);
```

**Request:**
```json
PUT /categories
{ "name": "Technology", "description": "Tech posts", "sortOrder": 1 }
```

If a category with `name: "Technology"` exists, it's updated. Otherwise, it's created.

---

## Versioning

Track record version history with rollback support.

```typescript
import {
  createVersionManager,
  setVersioningStorage,
  MemoryVersioningStorage,
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from 'hono-crud';

// Setup storage
setVersioningStorage(new MemoryVersioningStorage());

// Enable in model
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  versioning: true,
  // Or: versioning: { maxVersions: 50, includeMetadata: true }
});
```

**Version endpoints:**

```typescript
class UserVersionHistory extends VersionHistoryEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Version history' };
}

class UserVersionRead extends VersionReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Read specific version' };
}

class UserVersionCompare extends VersionCompareEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Compare versions' };
}

class UserVersionRollback extends VersionRollbackEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Rollback to version' };
}
```

---

## Audit Logging

Track who changed what and when.

```typescript
import {
  createAuditLogger,
  setAuditStorage,
  MemoryAuditLogStorage,
} from 'hono-crud';

// Setup storage
setAuditStorage(new MemoryAuditLogStorage());

// Enable in model
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  audit: true,
  // Or: audit: { includeChanges: true, includePrevious: true }
});
```

Audit entries include: action type, table, record ID, user ID, timestamp, and optionally the field-level changes.

---

## Full-Text Search

Weighted search with highlighting across multiple fields.

```typescript
import { SearchEndpoint } from 'hono-crud';

class UserSearch extends SearchEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Search users' };
}

// Register separately
app.get('/users/search', UserSearch);
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
import { AggregateEndpoint } from 'hono-crud';

class UserAggregate extends AggregateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Aggregate user data' };
}

app.get('/users/aggregate', UserAggregate);
```

**Query:**
```
GET /users/aggregate?aggregate=count:id,avg:age&groupBy=role
```

---

## Export / Import

Export and import records as CSV or JSON.

```typescript
import { ExportEndpoint, ImportEndpoint } from 'hono-crud';

class UserExport extends ExportEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Export users' };
}

class UserImport extends ImportEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Import users' };
}

app.get('/users/export', UserExport);
app.post('/users/import', UserImport);
```

**Export:**
```
GET /users/export?format=csv
GET /users/export?format=json&fields=id,name,email
```

**Import modes:**
- `create` - Create new records only
- `update` - Update existing records only
- `upsert` - Create or update

---

## Computed Fields

Virtual fields calculated at runtime, not stored in the database.

```typescript
import type { ComputedFieldsConfig } from 'hono-crud';

const computedFields: ComputedFieldsConfig = {
  fullName: {
    type: 'string',
    compute: (record) => `${record.firstName} ${record.lastName}`,
  },
  age: {
    type: 'number',
    compute: (record) => {
      const birth = new Date(record.birthDate);
      const today = new Date();
      return today.getFullYear() - birth.getFullYear();
    },
  },
  isActive: {
    type: 'boolean',
    compute: (record) => record.status === 'active' && record.emailVerified,
  },
};

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  computedFields,
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
import { CrudEventEmitter, setEventEmitter, getEventEmitter } from 'hono-crud';

const events = new CrudEventEmitter();
setEventEmitter(events);

// Subscribe to specific events
events.on('users', 'created', (event) => {
  console.log('User created:', event.recordId);
});

// Subscribe to all events on a table
events.on('users', '*', (event) => {
  console.log(`User ${event.type}:`, event.recordId);
});

// Subscribe to all events
events.onAny((event) => {
  console.log(`${event.type} on ${event.table}:`, event.recordId);
});
```

### Webhooks

```typescript
import { registerWebhooks } from 'hono-crud';

registerWebhooks({
  endpoints: [
    {
      url: 'https://hooks.example.com/crud',
      secret: process.env.WEBHOOK_SECRET,
      events: ['users:created', 'users:updated'],
      retries: 2,
      timeout: 10000,
    },
  ],
});
```

Webhooks are signed with HMAC-SHA256 using the Web Crypto API (edge-safe). The signature is included in the `X-Webhook-Signature` header.

---

## Encryption

Field-level encryption using AES-GCM via the Web Crypto API.

```typescript
import {
  encryptFields,
  decryptFields,
  StaticKeyProvider,
  type FieldEncryptionConfig,
} from 'hono-crud';

const keyProvider = new StaticKeyProvider(process.env.ENCRYPTION_KEY!);

const encryptionConfig: FieldEncryptionConfig[] = [
  { field: 'ssn', keyProvider },
  { field: 'creditCard', keyProvider },
];

// Encrypt before storing
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  async before(data) {
    return encryptFields(data, encryptionConfig);
  }
}

// Decrypt after reading
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  async after(record) {
    return decryptFields(record, encryptionConfig);
  }
}
```

---

## Idempotency

Prevent duplicate operations via idempotency keys.

```typescript
import {
  idempotency,
  setIdempotencyStorage,
  MemoryIdempotencyStorage,
} from 'hono-crud';

setIdempotencyStorage(new MemoryIdempotencyStorage());

// Apply to mutation endpoints
app.use('/api/*', idempotency({
  headerName: 'Idempotency-Key',  // default
  ttl: 86400,                      // 24 hours (default)
}));
```

Clients include `Idempotency-Key: <unique-key>` in the request header. If the same key is seen again within the TTL, the cached response is returned.

---

## Multi-Tenancy

Isolate data by tenant using header, path, query, or JWT extraction.

```typescript
import { multiTenant } from 'hono-crud';

// Extract tenant from header (default)
app.use('/api/*', multiTenant({
  source: 'header',
  headerName: 'X-Tenant-ID',  // default
  required: true,               // 400 if missing
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

**Model-level config:**

```typescript
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  multiTenant: {
    tenantIdField: 'tenantId',
    enforceOnCreate: true,
    enforceOnRead: true,
  },
});
```

---

## Health Checks

Liveness and readiness endpoints.

```typescript
import { createHealthEndpoints } from 'hono-crud';

createHealthEndpoints(app, {
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
      timeout: 3000,     // Per-check timeout
    },
  ],
});
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

// Throw in endpoint hooks
class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;

  async before(data) {
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
import { createErrorHandler, zodErrorMapper } from 'hono-crud';

const errorHandler = createErrorHandler({
  mappers: [zodErrorMapper],
  defaultStatus: 500,
  includeStack: process.env.NODE_ENV !== 'production',
});

app.onError(errorHandler);
```

### Exception Types

| Exception | Status | Use Case |
|-----------|--------|----------|
| `ApiException` | configurable | Base exception class |
| `NotFoundException` | 404 | Resource not found |
| `ConflictException` | 409 | Duplicate resource |
| `UnauthorizedException` | 401 | Authentication required |
| `ForbiddenException` | 403 | Insufficient permissions |
| `InputValidationException` | 400 | Invalid input data |
| `AggregationException` | 400 | Invalid aggregation query |
| `CacheException` | 500 | Cache operation failure |
| `ConfigurationException` | 500 | Invalid configuration |
| `RateLimitExceededException` | 429 | Rate limit exceeded |

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
GET /users?name[ilike]=%alice%
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
| `like` | LIKE (case-sensitive) | `?name[like]=%alice%` |
| `ilike` | ILIKE (case-insensitive) | `?name[ilike]=%alice%` |
| `in` | In list | `?role[in]=admin,user` |
| `between` | Between two values | `?age[between]=18,30` |
| `null` | Is null / is not null | `?age[null]=true` |

---

## Sorting & Pagination

```typescript
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  orderByFields = ['name', 'createdAt', 'age'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';
  defaultPerPage = 20;
  maxPerPage = 100;
}
```

**Query:**
```
GET /users?order_by=name&order_by_direction=asc
GET /users?page=2&per_page=50
```

**Response includes pagination metadata:**
```json
{
  "success": true,
  "result": [...],
  "page": 2,
  "per_page": 50,
  "total": 150,
  "page_count": 3
}
```

---

## API Versioning

```typescript
import { apiVersion, getApiVersion, versionedResponse } from 'hono-crud';

app.use('/api/*', apiVersion({
  strategy: 'header',     // 'header' | 'path' | 'query'
  headerName: 'API-Version',
  defaultVersion: '1',
  supported: ['1', '2'],
}));

app.get('/api/users', (c) => {
  const version = getApiVersion(c);

  return versionedResponse(c, userData, {
    '1': (data) => ({ id: data.id, name: data.name }),
    '2': (data) => ({ id: data.id, fullName: data.name, email: data.email }),
  });
});
```

---

## Serialization Profiles

Transform response data based on context (e.g., public vs admin views).

```typescript
import { applyProfile, type SerializationProfile } from 'hono-crud';

const publicProfile: SerializationProfile = {
  include: ['id', 'name', 'avatar'],
  exclude: ['email', 'role', 'createdAt'],
};

const adminProfile: SerializationProfile = {
  include: ['id', 'name', 'email', 'role', 'createdAt'],
};

// Apply in endpoint
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;

  async after(record) {
    const user = this.getContext().var.user;
    const profile = user?.roles?.includes('admin') ? adminProfile : publicProfile;
    return applyProfile(record, profile);
  }
}
```
