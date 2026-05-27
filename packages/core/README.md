# hono-crud

CRUD generator for [Hono](https://hono.dev) with Zod validation and OpenAPI generation.

Define a model once and register fully-typed Create / Read / Update / Delete / List endpoints. Core also ships auth, logging, events, encryption, serialization, audit, versioning, multi-tenant, and API-versioning helpers. Persistence adapters and docs UIs live in separate `@hono-crud/*` packages.

## Install

```bash
npm install hono-crud hono zod
```

You will also want a storage adapter, e.g. `@hono-crud/memory`, `@hono-crud/drizzle`, or `@hono-crud/prisma`.

## Usage

```ts
import { z } from 'zod';
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import { MemoryCreateEndpoint, MemoryReadEndpoint, MemoryListEndpoint } from '@hono-crud/memory';

const UserSchema = z.object({ id: z.string(), name: z.string() });
const model = defineModel({ schema: UserSchema, primaryKey: 'id' });
const meta = defineMeta({ tableName: 'users' });

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  model,
  meta,
  endpoints: { create: MemoryCreateEndpoint, read: MemoryReadEndpoint, list: MemoryListEndpoint },
});
```

See the [repository README](https://github.com/kshdotdev/hono-crud) for the full guide.
