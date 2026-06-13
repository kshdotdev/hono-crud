# @hono-crud/mcp

Auto-generate [Model Context Protocol](https://modelcontextprotocol.io) (MCP) tools from your
[hono-crud](https://github.com/kshdotdev/hono-crud) resources.

It introspects the CRUD endpoints you already register and exposes every operation present in the
endpoints map — all `registerCrud` verbs, from `list`/`read`/`create`/`update`/`delete` through
`search`, `aggregate`, `export`, the batch operations and the version sub-resources — as MCP tools
over HTTP streaming transport. Tool calls are **re-dispatched through the same Hono app**, so they
run the exact same pipeline as your REST API — auth, Zod validation, hooks, audit, soft-delete,
serialization and pagination all apply.

The only excluded verb is `import`: its schema intentionally declares no request body (validation
is manual, to support JSON, CSV and multipart payloads), so an auto-generated tool would advertise
an input schema lacking the items payload. Register a hand-written tool if you need imports over MCP.

## Install

```sh
npm i @hono-crud/mcp @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk`, `hono` and `zod` are peer dependencies. The optional OAuth strategy
brings its own router and middleware (see [Authentication](#authentication)) — this package has no
other dependencies.

## Usage

<!-- docs-typecheck:prelude -->
```ts
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
} from '@hono-crud/memory';
import { createCrudMcp } from '@hono-crud/mcp';
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { z } from 'zod';

const UserSchema = z.object({ id: z.uuid(), name: z.string(), email: z.email() });
const UserModel = defineModel({ tableName: 'users', schema: UserSchema, primaryKeys: ['id'] });
const userMeta = defineMeta({ model: UserModel });

class UserCreate extends MemoryCreateEndpoint { _meta = userMeta; }
class UserList extends MemoryListEndpoint { _meta = userMeta; }
class UserRead extends MemoryReadEndpoint { _meta = userMeta; }
class UserUpdate extends MemoryUpdateEndpoint { _meta = userMeta; }
class UserDelete extends MemoryDeleteEndpoint { _meta = userMeta; }

const userEndpoints = { create: UserCreate, list: UserList, read: UserRead, update: UserUpdate, delete: UserDelete };

const app = fromHono(new Hono());
registerCrud(app, '/users', userEndpoints);

const mcp = createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  instructions: 'Tools to manage users.',
});

mcp.resource('/users', userEndpoints);

app.all('/mcp', mcp.handler());
```

This generates one tool per operation in the endpoints map (`users_list`, `users_read`,
`users_create`, `users_update`, `users_delete`, and so on for any extended verbs you register),
each with an input schema derived from the endpoint's own Zod schema. Where the endpoint's 2xx
response is a plain JSON object schema, the tool also advertises a matching MCP `outputSchema` and
returns the parsed response as `structuredContent` alongside the text content.

## Operations and annotations

Every operation ships an MCP annotation profile an LLM client can act on:

| Operations | Annotations |
|---|---|
| `list`, `read`, `search`, `aggregate`, `export`, `versionHistory`, `versionRead`, `versionCompare` | `readOnlyHint: true` |
| `create`, `clone`, `batchCreate`, `batchUpdate`, `batchRestore`, `batchUpsert`, `bulkPatch`, `versionRollback` | `destructiveHint: false` |
| `update`, `upsert`, `restore` | `destructiveHint: false`, `idempotentHint: true` |
| `delete`, `batchDelete` | `destructiveHint: true` |

## Configuration

```ts
mcp.resource('/users', userEndpoints, {
  name: 'people',                              // resource label used in tool names
  description: 'User accounts.',               // base description for the resource's tools
  operations: ['list', 'read', 'create'],      // allow-list (default: all present, minus import)
  tools: {
    list: { name: 'find_people', description: 'Search people by name or role.' },
    create: { description: 'Create a person. Admin only.' },
    delete: { enabled: false },                // exclude an operation
  },
});
```

By default every operation present in the endpoints map (except `import`) becomes a tool;
`operations` narrows that set. Customize tool naming globally via
`createCrudMcp(app, { naming: ({ resource, operation }) => ... })`. MCP annotations
(`readOnlyHint`, `destructiveHint`, …) default per the table above and can be overridden per tool.

## Header forwarding

On re-dispatch, an allow-list of inbound `/mcp` headers (matched case-insensitively) is forwarded
to the CRUD routes so the call runs as the caller. The default —
`authorization`, `cookie`, `x-api-key`, `x-tenant-id` — covers bearer/session auth plus core's own
API-key middleware and header-based multi-tenancy. Override it when your pipeline reads custom
headers (a function form for full control may come later):

```ts
import { DEFAULT_FORWARD_HEADERS } from '@hono-crud/mcp';

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  forwardHeaders: [...DEFAULT_FORWARD_HEADERS, 'x-org-id'],
});
```

## Authentication

**Verifier (default, simple).** The token gates `/mcp` and is forwarded to the CRUD routes:

```ts
/** Your token verification — return an identity, or null to reject with 401. */
declare function verifySession(token: string): Promise<Record<string, unknown> | null>;

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: { strategy: 'verifier', verifyToken: (token) => verifySession(token) },
});
```

**Middleware.** Gate `/mcp` with existing Hono middleware (e.g. from `hono-crud/auth`):

```ts
import { createJWTMiddleware } from 'hono-crud/auth';

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: { strategy: 'middleware', middleware: createJWTMiddleware({ secret: 'top-secret' }) },
});
```

**OAuth 2.1 (opt-in).** Bring your own metadata router + bearer middleware (e.g. from
[`@hono/mcp`](https://github.com/honojs/middleware/tree/main/packages/mcp)'s `simpleMcpAuthRouter`
and `bearerAuth`):

<!-- docs-typecheck:skip external package (@hono/mcp) not installed in this repo -->
```ts
import { bearerAuth, simpleMcpAuthRouter } from '@hono/mcp/auth';

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: {
    strategy: 'oauth',
    router: simpleMcpAuthRouter({ issuer: 'https://issuer.example.com' }),
    bearer: bearerAuth({ verifier }),
  },
});
```

## License

MIT
