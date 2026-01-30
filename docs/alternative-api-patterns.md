# Alternative API Patterns

hono-crud provides four different ways to define CRUD endpoints. All patterns produce classes compatible with `registerCrud()` and can be mixed together in a single application.

## Overview

| Pattern | Best For | Verbosity | Flexibility |
|---------|----------|-----------|-------------|
| **Class-based** | Complex logic, database adapters | Medium | High |
| **Functional** | Quick setup, simple endpoints | Low | Medium |
| **Builder** | Readable chains, discoverability | Low | Medium |
| **Config-based** | Declarative, all-in-one definition | Low | Medium |

## Quick Comparison

```typescript
// All four patterns produce the same result:

// 1. Class-based
class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  filterFields = ['role'];
}

// 2. Functional
const UserList = createList({ meta: userMeta, filterFields: ['role'] }, MemoryListEndpoint);

// 3. Builder
const UserList = crud(userMeta).list().filter('role').build(MemoryListEndpoint);

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

```typescript
import { defineMeta, defineModel, registerCrud } from 'hono-crud';
import { MemoryListEndpoint, MemoryCreateEndpoint } from 'hono-crud/adapters/memory';

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create user' };

  async before(data) {
    return { ...data, createdAt: new Date() };
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role', 'status'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
  defaultOrderDirection = 'desc';
}

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
});
```

### With Database Adapters

For Drizzle and Prisma, you must provide the database connection as a class property:

```typescript
// Drizzle
import { DrizzleListEndpoint } from 'hono-crud/adapters/drizzle';

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = drizzleDb;  // Required for Drizzle
  filterFields = ['role'];
}

// Prisma
import { PrismaListEndpoint } from 'hono-crud/adapters/prisma';

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prismaClient;  // Required for Prisma
  filterFields = ['role'];
}
```

---

## Pattern 2: Functional API

Factory functions that return endpoint classes. Concise and easy to use for simple endpoints.

### Import

```typescript
import {
  createCreate,
  createList,
  createRead,
  createUpdate,
  createDelete,
} from 'hono-crud';
```

### Basic Usage

```typescript
const UserCreate = createCreate({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'Create user' },
  before: (data) => ({ ...data, createdAt: new Date() }),
}, MemoryCreateEndpoint);

const UserList = createList({
  meta: userMeta,
  schema: { tags: ['Users'], summary: 'List users' },
  filterFields: ['role', 'status'],
  searchFields: ['name', 'email'],
  orderByFields: ['name', 'createdAt'],
  defaultOrderDirection: 'desc',
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
  before: (data) => ({ ...data, updatedAt: new Date() }),
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
| `schema` | `object` | OpenAPI schema (tags, summary, description) |
| `before` | `function` | Hook called before create |
| `after` | `function` | Hook called after create |
| `allowNestedCreate` | `string[]` | Relations allowing nested creates |
| `beforeHookMode` | `'sequential' \| 'parallel'` | Hook execution mode |
| `afterHookMode` | `'sequential' \| 'parallel'` | Hook execution mode |

#### createList

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `filterFields` | `string[]` | Fields available for filtering |
| `filterConfig` | `object` | Advanced filter operators per field |
| `searchFields` | `string[]` | Fields available for search |
| `searchFieldName` | `string` | Search query parameter name (default: 'search') |
| `orderByFields` | `string[]` | Fields available for sorting |
| `defaultOrderBy` | `string` | Default sort field |
| `defaultOrderDirection` | `'asc' \| 'desc'` | Default sort direction |
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
| `before` | `function` | Hook called before update |
| `after` | `function` | Hook called after update |
| `transform` | `function` | Transform the result |

#### createDelete

| Option | Type | Description |
|--------|------|-------------|
| `meta` | `MetaInput` | Model metadata (required) |
| `schema` | `object` | OpenAPI schema |
| `lookupField` | `string` | Field for lookup (default: 'id') |
| `additionalFilters` | `string[]` | Additional filter fields |
| `includeCascadeResults` | `boolean` | Include cascade results in response |
| `before` | `function` | Hook called before delete |
| `after` | `function` | Hook called after delete |

---

## Pattern 3: Builder/Fluent API

Chainable API with method chaining for readable, discoverable configuration.

### Import

```typescript
import { crud } from 'hono-crud';
```

### Basic Usage

```typescript
const UserCreate = crud(userMeta)
  .create()
  .tags('Users')
  .summary('Create user')
  .description('Creates a new user account')
  .before((data) => ({ ...data, createdAt: new Date() }))
  .after((data) => console.log('Created:', data.id))
  .build(MemoryCreateEndpoint);

const UserList = crud(userMeta)
  .list()
  .tags('Users')
  .summary('List users')
  .filter('role', 'status')
  .search('name', 'email')
  .orderBy('name', 'createdAt')
  .defaultOrder('createdAt', 'desc')
  .pagination(20, 100)
  .include('profile', 'posts')
  .build(MemoryListEndpoint);

const UserRead = crud(userMeta)
  .read()
  .tags('Users')
  .summary('Get user')
  .lookupField('id')
  .include('profile')
  .build(MemoryReadEndpoint);

const UserUpdate = crud(userMeta)
  .update()
  .tags('Users')
  .summary('Update user')
  .allowedFields('name', 'role', 'status')
  .blockedFields('email', 'createdAt')
  .before((data) => ({ ...data, updatedAt: new Date() }))
  .build(MemoryUpdateEndpoint);

const UserDelete = crud(userMeta)
  .delete()
  .tags('Users')
  .summary('Delete user')
  .includeCascadeResults()
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
crud(meta)  // Returns CrudBuilder
  .create() // Returns CreateBuilder
  .list()   // Returns ListBuilder
  .read()   // Returns ReadBuilder
  .update() // Returns UpdateBuilder
  .delete() // Returns DeleteBuilder
```

#### Common Methods (all builders)

| Method | Description |
|--------|-------------|
| `.tags(...tags)` | Set OpenAPI tags |
| `.summary(text)` | Set OpenAPI summary |
| `.description(text)` | Set OpenAPI description |
| `.build(BaseClass)` | Build the endpoint class |

#### CreateBuilder

| Method | Description |
|--------|-------------|
| `.before(fn)` | Hook before create |
| `.after(fn)` | Hook after create |
| `.nestedCreate(...relations)` | Allow nested creates |
| `.hookMode(before, after)` | Set hook execution mode |

#### ListBuilder

| Method | Description |
|--------|-------------|
| `.filter(...fields)` | Enable filtering on fields |
| `.filterConfig(config)` | Advanced filter operators |
| `.search(...fields)` | Enable search on fields |
| `.searchParam(name)` | Set search parameter name |
| `.orderBy(...fields)` | Enable sorting on fields |
| `.defaultOrder(field, direction)` | Set default sort |
| `.pagination(perPage, maxPerPage)` | Configure pagination |
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
| `.before(fn)` | Hook before update |
| `.after(fn)` | Hook after update |
| `.transform(fn)` | Transform the result |
| `.hookMode(before, after)` | Set hook execution mode |

#### DeleteBuilder

| Method | Description |
|--------|-------------|
| `.lookupField(field)` | Set lookup field |
| `.additionalFilters(...fields)` | Add filter fields |
| `.includeCascadeResults()` | Include cascade info |
| `.before(fn)` | Hook before delete |
| `.after(fn)` | Hook after delete |
| `.hookMode(before, after)` | Set hook execution mode |

---

## Pattern 4: Config-based API

Single declarative object defining all endpoints at once.

### Import

```typescript
import { defineEndpoints, MemoryAdapters } from 'hono-crud';
```

### Basic Usage

```typescript
const userEndpoints = defineEndpoints({
  meta: userMeta,

  create: {
    openapi: { tags: ['Users'], summary: 'Create user' },
    hooks: {
      before: (data) => ({ ...data, createdAt: new Date() }),
      after: (data) => console.log('Created:', data.id),
    },
    nestedCreate: ['profile'],
  },

  list: {
    openapi: { tags: ['Users'], summary: 'List users' },
    filtering: {
      fields: ['role', 'status'],
      config: {
        age: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
      },
    },
    search: {
      fields: ['name', 'email'],
      paramName: 'q',
    },
    sorting: {
      fields: ['name', 'createdAt'],
      default: 'createdAt',
      defaultDirection: 'desc',
    },
    pagination: {
      defaultPerPage: 20,
      maxPerPage: 100,
    },
    includes: ['profile', 'posts'],
    hooks: {
      after: (items) => items,
      transform: (item) => item,
    },
  },

  read: {
    openapi: { tags: ['Users'], summary: 'Get user' },
    lookupField: 'id',
    includes: ['profile'],
    fieldSelection: {
      enabled: true,
      allowed: ['id', 'name', 'email', 'role'],
      blocked: ['password'],
    },
  },

  update: {
    openapi: { tags: ['Users'], summary: 'Update user' },
    fields: {
      allowed: ['name', 'role', 'status'],
      blocked: ['email', 'createdAt'],
    },
    hooks: {
      before: (data) => ({ ...data, updatedAt: new Date() }),
    },
  },

  delete: {
    openapi: { tags: ['Users'], summary: 'Delete user' },
    includeCascadeResults: true,
  },
}, MemoryAdapters);

// Register all endpoints at once
registerCrud(app, '/users', userEndpoints);
```

### Configuration Structure

```typescript
interface EndpointsConfig {
  meta: MetaInput;           // Required: model metadata
  create?: CreateConfig;     // Optional: create endpoint
  list?: ListConfig;         // Optional: list endpoint
  read?: ReadConfig;         // Optional: read endpoint
  update?: UpdateConfig;     // Optional: update endpoint
  delete?: DeleteConfig;     // Optional: delete endpoint
}
```

### Adapter Bundles

```typescript
// Built-in Memory adapter bundle
import { MemoryAdapters } from 'hono-crud';

// Create custom adapter bundles
const DrizzleAdapters = {
  CreateEndpoint: DrizzleCreateEndpoint,
  ListEndpoint: DrizzleListEndpoint,
  ReadEndpoint: DrizzleReadEndpoint,
  UpdateEndpoint: DrizzleUpdateEndpoint,
  DeleteEndpoint: DrizzleDeleteEndpoint,
};

const endpoints = defineEndpoints(config, DrizzleAdapters);
```

---

## Mixing Patterns

All patterns are fully compatible and can be mixed in a single application:

```typescript
// Builder pattern for create
const UserCreate = crud(userMeta)
  .create()
  .tags('Users')
  .before((data) => ({ ...data, createdAt: new Date() }))
  .build(MemoryCreateEndpoint);

// Functional pattern for list
const UserList = createList({
  meta: userMeta,
  filterFields: ['role'],
  searchFields: ['name'],
}, MemoryListEndpoint);

// Class-based pattern for read
class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'] };
}

// Config-based for update and delete
const { update: UserUpdate, delete: UserDelete } = defineEndpoints({
  meta: userMeta,
  update: { fields: { allowed: ['name'] } },
  delete: {},
}, MemoryAdapters);

// Mix them all together
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});
```

---

## Choosing a Pattern

### Use Class-based when:
- You need complex custom logic
- Using Drizzle or Prisma adapters (requires db/prisma property)
- You want full TypeScript intellisense on class properties
- You need to override multiple methods

### Use Functional when:
- You want quick, simple endpoint definitions
- Configuration is straightforward
- You prefer function composition

### Use Builder when:
- You want readable, self-documenting code
- You prefer method chaining
- You want IDE autocomplete to guide configuration

### Use Config-based when:
- You want to define all endpoints in one place
- You prefer declarative configuration
- You want consistent structure across endpoints
