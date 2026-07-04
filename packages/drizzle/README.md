# @hono-crud/drizzle

Drizzle ORM CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/drizzle hono-crud hono zod drizzle-orm drizzle-zod
```

## Usage

```ts
import {
  DrizzleCreateEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  type DrizzleDatabaseConstraint,
} from '@hono-crud/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { z } from 'zod';

declare const drizzleDb: DrizzleDatabaseConstraint; // your drizzle instance

const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

const UserSchema = z.object({ id: z.uuid(), name: z.string() });
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
});
const userMeta = defineMeta({ model: UserModel });

class UserCreate extends DrizzleCreateEndpoint { _meta = userMeta; db = drizzleDb; }
class UserRead extends DrizzleReadEndpoint { _meta = userMeta; db = drizzleDb; }
class UserList extends DrizzleListEndpoint { _meta = userMeta; db = drizzleDb; }

const app = fromHono(new Hono());
registerCrud(app, '/users', { create: UserCreate, read: UserRead, list: UserList });
```

## Durable audit & version-history storage

Persist audit logs and version history in your database (Cloudflare D1, libsql, postgres-js, …) so they survive across isolates/requests — the durable counterparts to the in-memory `MemoryAuditLogStorage` / `MemoryVersioningStorage`. One shared table backs every model; rows are discriminated by the model's `tableName`.

```ts
import {
  DrizzleAuditLogStorage,
  DrizzleVersioningStorage,
  type DrizzleDatabaseConstraint,
  sqliteAuditLogTable,
  sqliteVersionHistoryTable,
} from '@hono-crud/drizzle';
import { setAuditStorage } from 'hono-crud/audit';
import { setVersioningStorage } from 'hono-crud/versioning';

declare const db: DrizzleDatabaseConstraint; // your drizzle instance

// `sqliteAuditLogTable()` / `sqliteVersionHistoryTable()` build the D1/SQLite
// tables with the columns each storage expects — mirror their columns for
// Postgres/MySQL. The audit table's columns are: id, table_name, record_id,
// action, timestamp (epoch ms), user_id, record, previous_record, changes,
// metadata (the last four hold JSON).
setAuditStorage(new DrizzleAuditLogStorage({ db, table: sqliteAuditLogTable() }));
setVersioningStorage(new DrizzleVersioningStorage({ db, table: sqliteVersionHistoryTable() }));
```

Exports `DrizzleAdapters` (the 22-entry adapter bundle), the `Drizzle*Endpoint` classes, `createDrizzleCrud`, `createDrizzleSchemas`, the `DrizzleAuditLogStorage` / `DrizzleVersioningStorage` durable storages (with their `sqlite*Table` helpers), and the `DrizzleDatabaseConstraint` type.
