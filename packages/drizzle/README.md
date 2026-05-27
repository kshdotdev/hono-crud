# @hono-crud/drizzle

Drizzle ORM CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/drizzle hono-crud hono zod drizzle-orm drizzle-zod
```

## Usage

```ts
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '@hono-crud/drizzle';

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  model,
  meta,
  endpoints: { create: DrizzleCreateEndpoint, read: DrizzleReadEndpoint, list: DrizzleListEndpoint },
});
```

Exports `DrizzleAdapters`, the `Drizzle*Endpoint` classes, `createDrizzleCrud`, `createDrizzleSchemas`, and the `DrizzleDatabase` type.
