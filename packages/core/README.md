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
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { MemoryCreateEndpoint, MemoryListEndpoint, MemoryReadEndpoint } from '@hono-crud/memory';
import { z } from 'zod';

const UserSchema = z.object({ id: z.uuid(), name: z.string() });
const UserModel = defineModel({ tableName: 'users', schema: UserSchema, primaryKeys: ['id'] });
const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint { _meta = userMeta; }
class UserRead extends MemoryReadEndpoint { _meta = userMeta; }
class UserList extends MemoryListEndpoint { _meta = userMeta; }

const app = fromHono(new Hono());
registerCrud(app, '/users', { create: UserCreate, read: UserRead, list: UserList });
```

See the [repository README](https://github.com/kshdotdev/hono-crud) for the full guide.
