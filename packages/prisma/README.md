# @hono-crud/prisma

Prisma CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/prisma hono-crud hono zod @prisma/client pluralize fastest-levenshtein
```

## Usage

```ts
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaListEndpoint,
} from '@hono-crud/prisma';

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  model,
  meta,
  endpoints: { create: PrismaCreateEndpoint, read: PrismaReadEndpoint, list: PrismaListEndpoint },
});
```

Exports `PrismaAdapters` and the `Prisma*Endpoint` classes.
