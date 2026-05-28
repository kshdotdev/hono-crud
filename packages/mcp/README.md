# @hono-crud/mcp

Auto-generate [Model Context Protocol](https://modelcontextprotocol.io) (MCP) tools from your
[hono-crud](https://github.com/kshdotdev/hono-crud) resources.

It introspects the CRUD endpoints you already register and exposes each operation
(`list`, `read`, `create`, `update`, `delete`) as an MCP tool over HTTP streaming transport. Tool
calls are **re-dispatched through the same Hono app**, so they run the exact same pipeline as your
REST API — auth, Zod validation, hooks, audit, soft-delete, serialization and pagination all apply.

## Install

```sh
npm i @hono-crud/mcp @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk`, `hono` and `zod` are peer dependencies. The optional OAuth strategy
brings its own router and middleware (see [Authentication](#authentication)) — this package has no
other dependencies.

## Usage

```ts
import { createCrudMcp } from '@hono-crud/mcp';

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

This generates the tools `users_list`, `users_read`, `users_create`, `users_update`,
`users_delete`, each with an input schema derived from the endpoint's own Zod schema.

## Configuration

```ts
mcp.resource('/users', userEndpoints, {
  name: 'people',                              // resource label used in tool names
  description: 'User accounts.',               // base description for the resource's tools
  operations: ['list', 'read', 'create'],      // allow-list (default: all present)
  tools: {
    list: { name: 'find_people', description: 'Search people by name or role.' },
    create: { description: 'Create a person. Admin only.' },
    delete: { enabled: false },                // exclude an operation
  },
});
```

Customize tool naming globally via `createCrudMcp(app, { naming: ({ resource, operation }) => ... })`.
MCP annotations (`readOnlyHint`, `destructiveHint`, …) default sensibly per operation and can be
overridden per tool.

## Authentication

**Verifier (default, simple).** The token gates `/mcp` and is forwarded to the CRUD routes:

```ts
createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: { strategy: 'verifier', verifyToken: (token) => verifySession(token) },
});
```

**Middleware.** Gate `/mcp` with existing Hono middleware (e.g. `@hono-crud/core/auth`):

```ts
auth: { strategy: 'middleware', middleware: jwtAuth(...) }
```

**OAuth 2.1 (opt-in).** Bring your own metadata router + bearer middleware (e.g. from
[`@hono/mcp`](https://github.com/honojs/middleware/tree/main/packages/mcp)'s `simpleMcpAuthRouter`
and `bearerAuth`):

```ts
import { simpleMcpAuthRouter, bearerAuth } from '@hono/mcp/auth';

auth: {
  strategy: 'oauth',
  router: simpleMcpAuthRouter({ issuer: 'https://issuer.example.com' }),
  bearer: bearerAuth({ verifier }),
}
```

## License

MIT
