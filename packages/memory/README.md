# @hono-crud/memory

In-memory CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud). Ideal for tests, demos, and prototyping — no database required.

## Install

```bash
npm install @hono-crud/memory hono-crud hono zod
```

## Usage

```ts
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { z } from 'zod';

const UserSchema = z.object({ id: z.uuid(), name: z.string() });
const UserModel = defineModel({ tableName: 'users', schema: UserSchema, primaryKeys: ['id'] });
const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint { _meta = userMeta; }
class UserRead extends MemoryReadEndpoint { _meta = userMeta; }
class UserList extends MemoryListEndpoint { _meta = userMeta; }

const app = fromHono(new Hono());
registerCrud(app, '/users', { create: UserCreate, read: UserRead, list: UserList });

// Reset the in-memory store (handy in tests)
clearStorage();
```

Exports the `Memory*Endpoint` classes, the `MemoryAdapters` bundle, and the `getStore` / `clearStorage` helpers.
