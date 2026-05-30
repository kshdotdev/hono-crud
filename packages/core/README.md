<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kshdotdev/hono-crud/main/logo.svg">
  <img src="https://raw.githubusercontent.com/kshdotdev/hono-crud/main/logo-dark.svg" alt="hono-crud" width="124" height="124">
</picture>

# hono-crud

**CRUD generator for [Hono](https://hono.dev) with Zod validation and automatic OpenAPI generation.**

[![npm version](https://img.shields.io/npm/v/hono-crud?color=ff5b11&label=npm)](https://www.npmjs.com/package/hono-crud)
[![npm downloads](https://img.shields.io/npm/dm/hono-crud?color=ff5b11&label=downloads)](https://www.npmjs.com/package/hono-crud)
[![tests](https://img.shields.io/github/actions/workflow/status/kshdotdev/hono-crud/ci.yml?branch=main&label=tests)](https://github.com/kshdotdev/hono-crud/actions/workflows/ci.yml)
[![min+gzip](https://img.shields.io/bundlephobia/minzip/hono-crud?label=min%2Bgzip)](https://bundlephobia.com/package/hono-crud)
[![license](https://img.shields.io/npm/l/hono-crud?color=blue)](https://opensource.org/licenses/MIT)

</div>

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
