# MCP (Model Context Protocol)

The `@hono-crud/mcp` package turns the CRUD resources you already register into [Model Context Protocol](https://modelcontextprotocol.io) tools, so an AI agent (Claude, Cursor, any MCP client) can call your API.

It introspects each registered resource and exposes its operations — `list`, `read`, `create`, `update`, `delete` — as MCP tools over the HTTP streaming transport. **Tool calls are re-dispatched through the same Hono app**, so they run the exact same pipeline as your REST API: auth, Zod validation, hooks, audit, soft-delete, serialization, and pagination all apply. There is no second code path to keep in sync.

Install: `npm install @hono-crud/mcp @modelcontextprotocol/sdk`.

`hono`, `zod`, and `@modelcontextprotocol/sdk` are peer dependencies.

---

## Quick start

```typescript
import { Hono } from 'hono';
import { fromHono, registerCrud } from 'hono-crud';
import { createCrudMcp } from '@hono-crud/mcp';
import {
  MemoryCreateEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
} from '@hono-crud/memory';

const userEndpoints = {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
};

const app = fromHono(new Hono());
registerCrud(app, '/users', userEndpoints);

// Build the MCP server bound to the app.
const mcp = createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  instructions: 'Tools to manage users.', // optional guidance surfaced to the LLM
});

// Expose a resource (same endpoints map you passed to registerCrud).
mcp.resource('/users', userEndpoints);

// Mount the MCP endpoint.
app.all('/mcp', mcp.handler());
```

This registers five tools — `users_list`, `users_read`, `users_create`, `users_update`, `users_delete` — each with an input schema derived from the endpoint's own Zod schema (path params, query filters, and request body).

---

## How tool calls run

When a client calls a tool, the package rebuilds the matching HTTP request (method, path, query, body) and **re-dispatches it into your Hono app** via `app.request(...)`. The call flows through the real route — the same middleware, auth, validation, hooks, and serialization your REST clients hit. The tool result is the route's JSON response.

Incoming request headers on the MCP call are forwarded on re-dispatch, so a bearer token (or any header your CRUD pipeline reads) reaches the underlying route. This is what lets a single token gate both `/mcp` and the CRUD routes (see [Authentication](#authentication)).

Errors are returned as MCP tool errors (`isError: true`) with the message text; the failure is also logged through core's logger.

---

## Auto-registration

Instead of one `mcp.resource()` call per resource, let the server discover every resource you registered with `registerCrud(...)`:

```typescript
const mcp = createCrudMcp(app, { name: 'my-api', version: '1.0.0', auto: true });
app.all('/mcp', mcp.handler());
```

Pass an object to scope or override it:

```typescript
createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auto: {
    include: ['/users', '/posts/*'],          // globs/RegExp; default: all
    exclude: ['/internal/*'],                  // excludes always win
    operations: ['list', 'read'],              // default allow-list for every resource
    resources: {
      '/users': { operations: ['list', 'read', 'create'] }, // per-path override
    },
  },
});
```

Discovery runs once, when `handler()` is first called (after all your `registerCrud` calls). Manual `mcp.resource()` registrations take precedence over auto for the same path.

---

## Tool names and descriptions

The default tool name is `` `${resource}_${operation}` `` (e.g. `users_list`). The `resource` label is derived, in order, from the model's `tag`, then its `tableName`, then the last path segment. Override the scheme globally:

```typescript
createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  naming: ({ resource, operation }) => `${operation}_${resource}`, // -> list_users
});
```

Default descriptions per operation (a resource-level `description` is prepended when set):

| Operation | Default description |
|---|---|
| `list` | List _{resource}_ with optional filters, search, sorting and pagination. |
| `read` | Get a single _{resource}_ by id. |
| `create` | Create a new _{resource}_. |
| `update` | Update an existing _{resource}_ by id. |
| `delete` | Delete a _{resource}_ by id. |

Duplicate tool names across resources throw a `ConfigurationException` at registration — disambiguate with a resource `name`, a custom `naming` strategy, or per-tool `name` overrides.

---

## Annotations

MCP tool annotations are advisory hints an LLM client may surface to the user (e.g. confirm before a destructive action). Sensible per-operation defaults are applied and can be overridden per tool:

| Operation | `readOnlyHint` | `destructiveHint` |
|---|---|---|
| `list` | `true` | — |
| `read` | `true` | — |
| `create` | `false` | `false` |
| `update` | `false` | `false` |
| `delete` | `false` | `true` |

```typescript
mcp.resource('/users', userEndpoints, {
  tools: {
    delete: { annotations: { destructiveHint: true, title: 'Delete user (irreversible)' } },
  },
});
```

---

## Per-resource and per-tool configuration

```typescript
mcp.resource('/users', userEndpoints, {
  name: 'people',                            // resource label used in tool names
  description: 'User accounts.',             // prepended to each tool's description
  operations: ['list', 'read', 'create'],    // allow-list (default: all present)
  tools: {
    list: { name: 'find_people', description: 'Search people by name or role.' },
    create: { description: 'Create a person. Admin only.' },
    delete: { enabled: false },              // exclude one operation
  },
});
```

- `operations` is an allow-list applied before per-tool `enabled`.
- A `tools[op].name` overrides the naming strategy for that tool.
- A `tools[op].enabled: false` excludes the operation even if it's present in the endpoints map.

---

## Authentication

The `/mcp` endpoint is **open by default**. Pick a strategy via the `auth` option. A `401` uses core's canonical error envelope, so MCP tracks the same error shape as your REST API.

### Verifier (default, simplest)

Verify the bearer token yourself. The same token gates `/mcp` and is forwarded verbatim to the CRUD routes on re-dispatch, and the returned identity is attached to the Hono context as `auth`:

```typescript
createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: {
    strategy: 'verifier',
    verifyToken: (token, c) => verifySession(token), // return an identity, or null to reject
  },
});
```

### Middleware

Gate `/mcp` with existing Hono middleware (for example the JWT/API-key middleware from `hono-crud/auth`):

```typescript
import { createJWTMiddleware } from 'hono-crud/auth';

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: { strategy: 'middleware', middleware: createJWTMiddleware({ secret: env.JWT_SECRET }) },
});
```

### OAuth 2.1 (opt-in)

Full MCP OAuth, decoupled by design — you bring the metadata router and the bearer-auth middleware (for example from [`@hono/mcp`](https://github.com/honojs/middleware/tree/main/packages/mcp)), so this package never pulls extra dependencies:

```typescript
import { simpleMcpAuthRouter, bearerAuth } from '@hono/mcp/auth';

createCrudMcp(app, {
  name: 'my-api',
  version: '1.0.0',
  auth: {
    strategy: 'oauth',
    router: simpleMcpAuthRouter({ issuer: 'https://issuer.example.com' }),
    mountPath: '/',                 // where to mount the metadata router (default: '/')
    bearer: bearerAuth({ verifier }),
  },
});
```

---

## Connecting a client

The endpoint speaks MCP over the **Streamable HTTP** transport. Point any MCP client at `https://your-host/mcp`.

With the official SDK client:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://your-host/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);

const { tools } = await client.listTools();
const result = await client.callTool({
  name: 'users_list',
  arguments: { page: 1, per_page: 20, search: 'alice' },
});
```

At the protocol level it's JSON-RPC 2.0. Clients send `initialize`, then `notifications/initialized`, then `tools/list` / `tools/call`. Requests must accept both JSON and SSE and echo the session id returned by `initialize`:

```
content-type: application/json
accept: application/json, text/event-stream
mcp-session-id: <id from the initialize response>
```

```jsonc
// tools/call
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "users_create", "arguments": { "name": "Alice", "email": "alice@example.com" } } }
```

---

## Configuration reference

### `createCrudMcp(app, options)` — `CrudMcpOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | MCP server name advertised to clients. |
| `version` | `string` | — | MCP server version advertised to clients. |
| `instructions` | `string` | — | Free-form guidance surfaced to the LLM. |
| `naming` | `(ctx) => string` | `` `${resource}_${operation}` `` | Tool-name strategy. |
| `auth` | `McpAuthOptions` | none (open) | `/mcp` authentication strategy. |
| `auto` | `boolean \| AutoOptions` | `false` | Auto-register every `registerCrud` resource. |

### `mcp.resource(path, endpoints, options?)` — `ResourceOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | model `tag`/`tableName`, else path segment | Resource label used in tool names. |
| `description` | `string` | — | Prepended to each generated tool description. |
| `operations` | `OperationName[]` | all present | Allow-list of operations to expose. |
| `tools` | `Partial<Record<OperationName, ToolOptions>>` | `{}` | Per-operation overrides. |

### `ToolOptions`

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Full custom tool name (overrides `naming`). |
| `description` | `string` | Custom tool description. |
| `enabled` | `boolean` | `false` excludes the operation. |
| `annotations` | `ToolAnnotations` | Merged over the per-operation defaults. |

### `AutoOptions`

| Option | Type | Description |
|---|---|---|
| `include` | `PathPattern[]` | Only auto-register matching paths (default: all). |
| `exclude` | `PathPattern[]` | Skip matching paths (excludes win). |
| `operations` | `OperationName[]` | Default allow-list for every auto-registered resource. |
| `resources` | `Record<string, ResourceOptions>` | Per-path overrides, keyed by the `registerCrud` path. |
