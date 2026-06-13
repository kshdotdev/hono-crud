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

Exports `DrizzleAdapters` (the 22-entry adapter bundle), the `Drizzle*Endpoint` classes, `createDrizzleCrud`, `createDrizzleSchemas`, and the `DrizzleDatabaseConstraint` type.
