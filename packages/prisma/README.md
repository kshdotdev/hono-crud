# @hono-crud/prisma

Prisma CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/prisma hono-crud hono zod @prisma/client pluralize fastest-levenshtein
```

## Usage

```ts
import {
  PrismaCreateEndpoint,
  PrismaListEndpoint,
  PrismaReadEndpoint,
  type PrismaClient,
} from '@hono-crud/prisma';
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { z } from 'zod';

declare const prismaClient: PrismaClient; // your generated Prisma client

const UserSchema = z.object({ id: z.uuid(), name: z.string() });
const UserModel = defineModel({ tableName: 'users', schema: UserSchema, primaryKeys: ['id'] });
const userMeta = defineMeta({ model: UserModel });

class UserCreate extends PrismaCreateEndpoint { _meta = userMeta; prisma = prismaClient; }
class UserRead extends PrismaReadEndpoint { _meta = userMeta; prisma = prismaClient; }
class UserList extends PrismaListEndpoint { _meta = userMeta; prisma = prismaClient; }

const app = fromHono(new Hono());
registerCrud(app, '/users', { create: UserCreate, read: UserRead, list: UserList });
```

Exports `PrismaAdapters`, the `Prisma*Endpoint` classes, `createPrismaCrud`, and the `PrismaClient` structural type.
