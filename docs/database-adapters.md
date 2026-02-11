# Database Adapters

hono-crud ships with three adapters: **Memory** (prototyping), **Drizzle** (SQL via Drizzle ORM), and **Prisma** (SQL via Prisma).

All adapters expose the same endpoint class hierarchy: `Create`, `Read`, `Update`, `Delete`, `List`, plus `Restore`, `Upsert`, `BatchCreate`, `BatchUpdate`, `BatchDelete`, `BatchRestore`, `BatchUpsert`, and `BulkPatch`.

---

## Memory Adapter

Zero-dependency, in-memory storage. Ideal for prototyping, testing, and examples.

### Setup

```typescript
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryRestoreEndpoint,
  MemoryUpsertEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  clearStorage,
} from 'hono-crud/adapters/memory';
```

### Complete Example

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from 'hono-crud/adapters/memory';

clearStorage();

const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  done: z.boolean().default(false),
});

const TaskModel = defineModel({
  tableName: 'tasks',
  schema: TaskSchema,
  primaryKeys: ['id'],
});

const taskMeta = defineMeta({ model: TaskModel });

class TaskCreate extends MemoryCreateEndpoint {
  _meta = taskMeta;
  schema = { tags: ['Tasks'], summary: 'Create task' };
}

class TaskList extends MemoryListEndpoint {
  _meta = taskMeta;
  schema = { tags: ['Tasks'], summary: 'List tasks' };
  filterFields = ['done'];
  searchFields = ['title'];
}

class TaskRead extends MemoryReadEndpoint {
  _meta = taskMeta;
  schema = { tags: ['Tasks'], summary: 'Get task' };
}

class TaskUpdate extends MemoryUpdateEndpoint {
  _meta = taskMeta;
  schema = { tags: ['Tasks'], summary: 'Update task' };
  allowedUpdateFields = ['title', 'done'];
}

class TaskDelete extends MemoryDeleteEndpoint {
  _meta = taskMeta;
  schema = { tags: ['Tasks'], summary: 'Delete task' };
}

const app = fromHono(new Hono());

registerCrud(app, '/tasks', {
  create: TaskCreate,
  list: TaskList,
  read: TaskRead,
  update: TaskUpdate,
  delete: TaskDelete,
});
```

### Storage Helpers

```typescript
import { clearStorage, getStorage } from 'hono-crud/adapters/memory';

// Clear all in-memory data
clearStorage();

// Access raw storage for a table
const store = getStorage<Task>('tasks');
store.set('some-id', { id: 'some-id', title: 'Test', done: false });
```

---

## Drizzle Adapter

For production use with [Drizzle ORM](https://orm.drizzle.team). Supports PostgreSQL, MySQL, SQLite, and Turso.

### Install Dependencies

```bash
npm install drizzle-orm
```

### Schema Definition

```typescript
// schema.ts
import { pgTable, text, integer, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user', 'guest']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('user'),
  age: integer('age'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});
```

### Factory Pattern (Recommended)

The `createDrizzleCrud` factory pre-configures `db` and `_meta` on all endpoint classes:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import { createDrizzleCrud } from 'hono-crud/adapters/drizzle';
import { db } from './db';
import { users } from './schema';

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  age: z.number().int().positive().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,           // Drizzle table reference
  softDelete: true,
});

const userMeta = defineMeta({ model: UserModel });

// Factory creates base classes with db + meta pre-configured
const User = createDrizzleCrud(db, userMeta);

class UserCreate extends User.Create {
  schema = { tags: ['Users'], summary: 'Create user' };
}

class UserList extends User.List {
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
}

class UserRead extends User.Read {
  schema = { tags: ['Users'], summary: 'Get user' };
}

class UserUpdate extends User.Update {
  schema = { tags: ['Users'], summary: 'Update user' };
  allowedUpdateFields = ['name', 'role', 'age'];
}

class UserDelete extends User.Delete {
  schema = { tags: ['Users'], summary: 'Delete user' };
}

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});
```

The factory also provides `User.Restore`, `User.Upsert`, `User.BatchCreate`, `User.BatchUpdate`, `User.BatchDelete`, `User.BatchRestore`, and `User.BatchUpsert`.

### Manual Pattern

Set `db` and `_meta` on each endpoint class:

```typescript
import {
  DrizzleCreateEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  type DrizzleDatabase,
} from 'hono-crud/adapters/drizzle';

const typedDb = db as unknown as DrizzleDatabase;

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role'];
}
```

### Config-based with Drizzle

```typescript
import { defineEndpoints } from 'hono-crud';
import { DrizzleAdapters } from 'hono-crud/adapters/drizzle';

const endpoints = defineEndpoints({
  meta: userMeta,
  list: { filtering: { fields: ['role'] } },
  read: {},
}, DrizzleAdapters);
```

---

## Prisma Adapter

For production use with [Prisma](https://www.prisma.io).

### Install Dependencies

```bash
npm install @prisma/client
npx prisma init
```

### Schema Definition

```prisma
// schema.prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  role      String   @default("user")
  age       Int?
  createdAt DateTime @default(now()) @map("created_at")
  deletedAt DateTime? @map("deleted_at")

  posts     Post[]
  profile   Profile?

  @@map("users")
}
```

### Complete Example

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
} from 'hono-crud/adapters/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  age: z.number().int().positive().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(),
});

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });

class UserCreate extends PrismaCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Create user' };
}

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'List users' };
  filterFields = ['role'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'createdAt'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';
  defaultPerPage = 20;
  maxPerPage = 100;
}

class UserRead extends PrismaReadEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Get user' };
}

class UserUpdate extends PrismaUpdateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Update user' };
  allowedUpdateFields = ['name', 'role', 'age'];
}

class UserDelete extends PrismaDeleteEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Delete user' };
}

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
});
```

### Model Name Mapping

Prisma uses the model name to determine the table. If your model name differs from the `tableName`, register a mapping:

```typescript
import { registerPrismaModelMapping } from 'hono-crud/adapters/prisma';

// Map table name to Prisma model name
registerPrismaModelMapping('users', 'User');
registerPrismaModelMapping('blog_posts', 'BlogPost');
```

### Batch Operations

```typescript
import {
  PrismaBatchCreateEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchDeleteEndpoint,
} from 'hono-crud/adapters/prisma';

class UserBatchCreate extends PrismaBatchCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Batch create users' };
  maxBatchSize = 100;
}
```

---

## Choosing an Adapter

| Feature | Memory | Drizzle | Prisma |
|---------|--------|---------|--------|
| Setup complexity | None | Low | Medium |
| Persistence | In-memory only | Full SQL | Full SQL |
| Edge runtime | Yes | Yes | Partial |
| Relations support | In-memory joins | SQL joins | Prisma queries |
| Best for | Prototyping, tests | Production | Production |
