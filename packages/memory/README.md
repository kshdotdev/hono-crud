# @hono-crud/memory

In-memory CRUD adapter for [hono-crud](https://github.com/kshdotdev/hono-crud). Ideal for tests, demos, and prototyping — no database required.

## Install

```bash
npm install @hono-crud/memory hono-crud hono zod
```

## Usage

```ts
import { fromHono, registerCrud, defineModel, defineMeta } from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '@hono-crud/memory';

const app = fromHono(new Hono());
registerCrud(app, '/users', {
  model,
  meta,
  endpoints: { create: MemoryCreateEndpoint, read: MemoryReadEndpoint, list: MemoryListEndpoint },
});

// Reset the in-memory store (handy in tests)
clearStorage();
```

Exports `Memory*Endpoint` classes plus `getStorage` / `clearStorage` helpers.
