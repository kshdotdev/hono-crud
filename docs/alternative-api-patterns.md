# Alternative API Patterns

hono-crud provides four different ways to define CRUD endpoints. All patterns produce classes compatible with `registerCrud()` and can be mixed together in a single application.

## Overview

| Pattern | Best For | Verbosity | Verb coverage |
|---------|----------|-----------|---------------|
| **Class-based** | Complex logic, database adapters | Medium | All 22 verbs |
| **Functional** | Quick setup, simple endpoints | Low | 5 basic verbs |
| **Builder** | Readable chains, discoverability | Low | 5 basic verbs |
| **Config-based** | Declarative, all-in-one definition | Low | All 22 verbs |

The functional and builder APIs are deliberate sugar over the 5 basic verbs (create/list/read/update/delete). The config-based API (`defineEndpoints`) covers every `registerCrud` verb — including search, aggregate, batch.*, export/import, upsert, clone, bulk-patch and the four versioning verbs — and the class API is the full-power surface.

## Shared Setup

All samples on this page share one model, meta, and app:

<!-- docs-typecheck:prelude -->
```typescript
import { Hono } from 'hono';
import type { Env } from 'hono';
import { z } from 'zod';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
} from '@hono-crud/memory';

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  age: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type User = z.infer<typeof UserSchema>;

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

const app = fromHono(new Hono());
```

## Quick Comparison

```typescript
import { defineEndpoints } from 'hono-crud';
import { createList } from 'hono-crud/functional';
import { crud } from 'hono-crud/builder';
import { MemoryAdapters } from '@hono-crud/memory';

// All four patterns produce the same endpoint:

// 1. Class-based
class UserListClass extends MemoryListEndpoint {
  _meta = userMeta;
  filterFields = ['role'];
}

// 2. Functional
const UserListFunctional = createList({ meta: userMeta, filterFields: ['role'] }, MemoryListEndpoint);

// 3. Builder
const UserListBuilder = crud(userMeta).list().filter('role').build(MemoryListEndpoint);

// 4. Config-based
const endpoints = defineEndpoints({
  meta: userMeta,
  list: { filtering: { fields: ['role'] } },
}, MemoryAdapters);
```

---

## Pattern 1: Class-based (Traditional)

The original approach using class inheritance. Best for complex logic, custom methods, and database adapters (Drizzle, Prisma).

### Basic Usage

Model, meta, and app come from the [shared setup](#shared-setup) above. Passing the meta type as the second generic (`MemoryCreateEndpoint<Env, typeof userMeta>`) gives hook overrides like `before` fully typed parameters:

```typescript
class UserCreate extends MemoryCreateEndpoint<Env, typeof userMeta> {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create user' };

  override async before(data: User): Promise<User> {
    return { ...data, createdAt: new Date().toISOString() };
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
  sortFields = ['name', 'createdAt'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };
}

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
});
```

### With Database Adapters

For Drizzle and Prisma, provide the database connection as a class property:

```typescript
import { type DrizzleDatabaseConstraint, DrizzleListEndpoint } from '@hono-crud/drizzle';
import { PrismaListEndpoint } from '@hono-crud/prisma';
import { PrismaClient } from '@prisma/client';

declare const drizzleDb: DrizzleDatabaseConstraint; // your drizzle(...) instance
declare const prismaClient: PrismaClient; // your generated Prisma client

// Drizzle
class DrizzleUserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = drizzleDb; // Required for Drizzle
  filterFields = ['role'];
}

// Prisma
class PrismaUserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prismaClient; // Required for Prisma
  filterFields = ['role'];
}
```

---

## Pattern 2: Functional API

Factory functions that return endpoint classes. Concise and easy to use for simple endpoints.

### Import

<!-- docs-typecheck:prelude -->
```typescript
import {
  createCreate,
  createList,
  createRead,
  createUpdate,
  createDelete,
} from 'hono-crud/functional';
```

### Basic Usage

```typescript
const UserCreate = createCreate({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'Create user' },
  before: (data) => ({ ...data, createdAt: new Date().toISOString() }),
}, MemoryCreateEndpoint);

const UserList = createList({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'List users' },
  filterFields: ['role', 'status'],
  searchFields: ['name', 'email'],
  sortFields: ['name', 'createdAt'],
  defaultSort: { field: 'createdAt', order: 'desc' },
  defaultPerPage: 20,
  maxPerPage: 100,
}, MemoryListEndpoint);

const UserRead = createRead({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'Get user' },
  allowedIncludes: ['profile', 'posts'],
}, MemoryReadEndpoint);

const UserUpdate = createUpdate({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'Update user' },
  allowedUpdateFields: ['name', 'role', 'status'],
  before: (data) => ({ ...data, updatedAt: new Date().toISOString() }),
}, MemoryUpdateEndpoint);

const UserDelete = createDelete({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'Delete user' },
  includeCascadeResults: true,
}, MemoryDeleteEndpoint);

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});
```

### Configuration Options

#### createCreate

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `Partial<OpenAPIRouteSchema>` | OpenAPI schema — tags/summary/description, plus `responses`/`request`/`security`/`operationId` overrides merged over the generated blocks |
| `before` | `function` | Hook called before create — `(data, ctx?: HookContext)` |
| `after` | `function` | Hook called after create — `(data, ctx?: HookContext)` |
| `allowNestedCreate` | `string[]` | Relations allowing nested creates |
| `beforeHookMode` | `'sequential' \| 'parallel' \| 'fire-and-forget'` | Hook execution mode |
| `afterHookMode` | `'sequential' \| 'parallel' \| 'fire-and-forget'` | Hook execution mode |
| `bodySchema` | `ZodObject` | Override the request body validation schema |

#### createList

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `filterFields` | `string[]` | Fields available for filtering |
| `filterConfig` | `object` | Advanced filter operators per field |
| `searchFields` | `string[]` | Fields available for search |
| `searchParamName` | `string` | Inline-search query parameter name (default: `'search'`; the dedicated `/search` endpoint deliberately defaults to `'q'`) |
| `sortFields` | `string[]` | Fields available for sorting |
| `defaultSort` | `{ field: string; order: 'asc' \| 'desc' }` | Default sort field and direction |
| `defaultPerPage` | `number` | Default page size (default: 20) |
| `maxPerPage` | `number` | Maximum page size (default: 100) |
| `allowedIncludes` | `string[]` | Allowed relation names |
| `fieldSelectionEnabled` | `boolean` | Enable field selection |
| `after` | `function` | Hook called after list |
| `transform` | `function` | Transform each item |

#### createRead

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `lookupField` | `string` | Field for lookup (default: 'id') |
| `additionalFilters` | `string[]` | Additional filter fields |
| `allowedIncludes` | `string[]` | Allowed relation names |
| `fieldSelectionEnabled` | `boolean` | Enable field selection |
| `after` | `function` | Hook called after read |
| `transform` | `function` | Transform the item |

#### createUpdate

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `lookupField` | `string` | Field for lookup (default: 'id') |
| `allowedUpdateFields` | `string[]` | Fields allowed to update |
| `blockedUpdateFields` | `string[]` | Fields blocked from updating |
| `allowNestedWrites` | `string[]` | Relations allowing nested writes |
| `before` | `function` | Hook called before update — `(data, ctx?: HookContext)` |
| `after` | `AfterUpdateHook` | Hook called after update — `(prior, current, ctx)` |
| `transform` | `function` | Transform the result |
| `bodySchema` | `ZodObject` | Override the request body validation schema |

#### createDelete

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `lookupField` | `string` | Field for lookup (default: 'id') |
| `additionalFilters` | `string[]` | Additional filter fields |
| `includeCascadeResults` | `boolean` | Include cascade results in response |
| `before` | `function` | Hook called before delete — `(lookupValue, ctx?: HookContext)` |
| `after` | `AfterDeleteHook` | Hook called after delete — `(prior, ctx)` |

---

## Pattern 3: Builder/Fluent API

Chainable API with method chaining for readable, discoverable configuration.

### Import

<!-- docs-typecheck:prelude -->
```typescript
import { crud } from 'hono-crud/builder';
```

### Basic Usage

```typescript
const UserCreate = crud(userMeta)
  .create()
  .tags('Users')
  .summary('Create user')
  .before((data) => ({ ...data, createdAt: new Date().toISOString() }))
  .build(MemoryCreateEndpoint);

const UserList = crud(userMeta)
  .list()
  .tags('Users')
  .summary('List users')
  .filter('role', 'status')
  .search('name', 'email')
  .sortable('name', 'createdAt')
  .defaultSort('createdAt', 'desc')
  .pagination(20, 100)
  .include('profile', 'posts')
  .build(MemoryListEndpoint);

const UserRead = crud(userMeta)
  .read()
  .tags('Users')
  .summary('Get user')
  .include('profile')
  .build(MemoryReadEndpoint);

const UserUpdate = crud(userMeta)
  .update()
  .tags('Users')
  .summary('Update user')
  .allowedFields('name', 'role', 'status')
  .before((data) => ({ ...data, updatedAt: new Date().toISOString() }))
  .build(MemoryUpdateEndpoint);

const UserDelete = crud(userMeta)
  .delete()
  .tags('Users')
  .summary('Delete user')
  .includeCascade()
  .build(MemoryDeleteEndpoint);

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});
```

### Available Methods

#### Entry Point

```typescript
const builder = crud(userMeta); // CrudBuilder

builder.create(); // Returns CreateBuilder
builder.list();   // Returns ListBuilder
builder.read();   // Returns ReadBuilder
builder.update(); // Returns UpdateBuilder
builder.delete(); // Returns DeleteBuilder
```

#### Common Methods (all builders)

| Method | Description |
|--------|-------------|
| `.tags(...tags)` | Set OpenAPI tags |
| `.summary(text)` | Set OpenAPI summary |
| `.description(text)` | Set OpenAPI description |
| `.openapi(schema)` | Merge a raw `Partial<OpenAPIRouteSchema>` fragment (`responses`, `request`, `security`, `operationId`, ...) over the generated schema |
| `.middleware(...handlers)` | Add per-endpoint middleware |
| `.build(BaseClass)` | Build the endpoint class |

#### CreateBuilder

| Method | Description |
|--------|-------------|
| `.before(fn)` | Hook before create — `(data, ctx?: HookContext)` |
| `.after(fn)` | Hook after create — `(data, ctx?: HookContext)` |
| `.nestedCreate(...relations)` | Allow nested creates |
| `.beforeMode(mode)` | Before-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |
| `.afterMode(mode)` | After-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |
| `.bodySchema(schema)` | Override the request body validation schema |

#### ListBuilder

| Method | Description |
|--------|-------------|
| `.filter(...fields)` | Enable filtering on fields |
| `.filterWith(config)` | Advanced filter operators |
| `.search(...fields)` | Enable search on fields |
| `.searchParam(name)` | Set search parameter name (default: `'search'`) |
| `.sortable(...fields)` | Enable sorting on fields |
| `.defaultSort(field, order?)` | Set default sort (order defaults to `'asc'`) |
| `.pagination(perPage, maxPerPage?)` | Configure pagination |
| `.include(...relations)` | Allow relation includes |
| `.fieldSelection(config)` | Configure field selection |
| `.after(fn)` | Hook after list |
| `.transform(fn)` | Transform each item |

#### ReadBuilder

| Method | Description |
|--------|-------------|
| `.lookupField(field)` | Set lookup field |
| `.additionalFilters(...fields)` | Add filter fields |
| `.include(...relations)` | Allow relation includes |
| `.fieldSelection(config)` | Configure field selection |
| `.after(fn)` | Hook after read |
| `.transform(fn)` | Transform the item |

#### UpdateBuilder

| Method | Description |
|--------|-------------|
| `.lookupField(field)` | Set lookup field |
| `.allowedFields(...fields)` | Fields allowed to update |
| `.blockedFields(...fields)` | Fields blocked from update |
| `.nestedWrites(...relations)` | Allow nested writes |
| `.before(fn)` | Hook before update — `(data, ctx?: HookContext)` |
| `.after(fn)` | Hook after update — `AfterUpdateHook`: `(prior, current, ctx)` |
| `.transform(fn)` | Transform the result |
| `.beforeMode(mode)` | Before-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |
| `.afterMode(mode)` | After-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |
| `.bodySchema(schema)` | Override the request body validation schema |

#### DeleteBuilder

| Method | Description |
|--------|-------------|
| `.lookupField(field)` | Set lookup field |
| `.additionalFilters(...fields)` | Add filter fields |
| `.includeCascade(include?)` | Include cascade info (defaults to `true`) |
| `.before(fn)` | Hook before delete — `(lookupValue, ctx?: HookContext)` |
| `.after(fn)` | Hook after delete — `AfterDeleteHook`: `(prior, ctx)` |
| `.beforeMode(mode)` | Before-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |
| `.afterMode(mode)` | After-hook execution mode (`'sequential' \| 'parallel' \| 'fire-and-forget'`) |

---

## Pattern 4: Config-based API

Single declarative object defining all endpoints at once. Every `registerCrud` verb has a config slot — the 5 basic verbs plus `search`, `aggregate`, `restore`, `batchCreate`, `batchUpdate`, `batchDelete`, `batchRestore`, `batchUpsert`, `export`, `import`, `upsert`, `clone`, `bulkPatch`, `versionHistory`, `versionRead`, `versionCompare` and `versionRollback`.

Each endpoint's `openapi` accepts the full `Partial<OpenAPIRouteSchema>`: user-supplied `responses`/`request`/`security`/`operationId` blocks are merged over the generated schema.

Configuring a verb whose adapter bundle does not ship the matching base class throws at definition time — explicit configuration never degrades to a silently missing route.

### Import

<!-- docs-typecheck:prelude -->
```typescript
import { defineEndpoints } from 'hono-crud';
import { MemoryAdapters } from '@hono-crud/memory';
```

### Basic Usage

```typescript
const userEndpoints = defineEndpoints({
  meta: userMeta,

  create: {
    openapi: { tags: ['Users'], summary: 'Create user' },
    hooks: {
      before: (data) => ({ ...data, createdAt: new Date().toISOString() }),
    },
  },

  list: {
    openapi: { tags: ['Users'], summary: 'List users' },
    filtering: {
      fields: ['role', 'status'],
      config: {
        age: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
      },
    },
    search: { fields: ['name', 'email'] },
    sorting: {
      fields: ['name', 'createdAt'],
      default: 'createdAt',
      defaultOrder: 'desc',
    },
    pagination: { defaultPerPage: 20, maxPerPage: 100 },
    includes: ['profile', 'posts'],
  },

  read: {
    openapi: { tags: ['Users'], summary: 'Get user' },
    includes: ['profile'],
  },

  update: {
    openapi: { tags: ['Users'], summary: 'Update user' },
    fields: { allowed: ['name', 'role', 'status'] },
    hooks: {
      before: (data) => ({ ...data, updatedAt: new Date().toISOString() }),
    },
  },

  delete: {
    openapi: { tags: ['Users'], summary: 'Delete user' },
    includeCascadeResults: true,
  },
}, MemoryAdapters);

registerCrud(app, '/users', userEndpoints);
```

### Adapter Bundles

`MemoryAdapters` (imported above) is the built-in in-memory bundle. Database bundles work the same way — `DrizzleAdapters` from `@hono-crud/drizzle` and `PrismaAdapters` from `@hono-crud/prisma`:

```typescript
import { DrizzleAdapters } from '@hono-crud/drizzle';

const endpoints = defineEndpoints({
  meta: userMeta,
  create: {},
  list: {},
}, DrizzleAdapters);
```

---

## Mixing Patterns

All patterns are fully compatible and can be mixed in a single `registerCrud` call:

```typescript
// Builder for create
const UserCreate = crud(userMeta)
  .create()
  .tags('Users')
  .before((data) => ({ ...data, createdAt: new Date().toISOString() }))
  .build(MemoryCreateEndpoint);

// Functional for list
const UserList = createList({
  meta: userMeta,
  filterFields: ['role'],
  searchFields: ['name'],
}, MemoryListEndpoint);

// Class-based for read
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'] };
}

// Mix them together
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
});
```

---

## Choosing a Pattern

**Use Class-based when:**
- You need complex custom logic
- Using Drizzle or Prisma adapters (requires `db`/`prisma` property)
- You want full TypeScript intellisense on class properties
- You need to override multiple methods

**Use Functional when:**
- You want quick, simple endpoint definitions
- Configuration is straightforward
- You prefer function composition
- The 5 basic verbs are all you need (extended verbs live on the config and class APIs)

**Use Builder when:**
- You want readable, self-documenting code
- You prefer method chaining
- You want IDE autocomplete to guide configuration
- The 5 basic verbs are all you need (extended verbs live on the config and class APIs)

**Use Config-based when:**
- You want to define all endpoints in one place
- You prefer declarative configuration
- You want consistent structure across endpoints
- You need extended verbs (search, batch.*, upsert, bulk-patch, versioning) without writing classes
