# Typed RPC client (`hc`)

Hono ships a typed fetch client: `hc<typeof app>(baseUrl)` turns the route
schema accumulated on an app into a client whose paths, params, bodies and
responses are checked at compile time, and `InferRequestType` /
`InferResponseType` read those shapes back out for your own types.

Apps built with `fromHono` and `registerCrud` participate in that schema, so a
frontend can consume a hono-crud API without a generated SDK.

<!-- docs-typecheck:prelude -->
```ts
import { createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { OpenAPIRoute, type OpenAPIRouteSchema, defineMeta, defineModel } from 'hono-crud';
import { z } from 'zod';

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  budgetCents: z.number().nullable(),
  createdAt: z.number(),
});

const ProjectModel = defineModel({
  tableName: 'projects',
  schema: ProjectSchema,
  primaryKeys: ['id'],
  timestamps: true,
});

// `fields` narrows the create/update body the client sees.
const projectMeta = defineMeta({
  model: ProjectModel,
  fields: z.object({ name: z.string().min(1), budgetCents: z.number().nullable() }),
});

const Projects = createMemoryCrud(projectMeta);
```

## Build the app so the types accumulate

Three rules:

1. Construct the app with `new OpenAPIHono<Env>()` and wrap it with `fromHono`.
2. Register class routes and CRUD resources **before** plain handlers in a
   chain (Hono's own verb overloads match plain handlers first and return
   Hono's type), or keep plain handlers in separate statements.
3. Export `typeof` the **returned** app — `registerCrud` returns the app typed
   with the routes it added.

<!-- docs-typecheck:prelude -->
```ts
import { type InferRequestType, type InferResponseType, hc } from 'hono/client';
import { fromHono, registerCrud, registerCrudResources } from 'hono-crud';

class ProjectFinance extends OpenAPIRoute {
  // `satisfies` (not `as const`) keeps status keys and zod identities literal.
  schema = {
    tags: ['Projects'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ month: z.string().optional() }),
    },
    responses: {
      200: {
        description: 'Finance summary',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              result: z.object({ totalCents: z.number(), months: z.array(z.string()) }),
            }),
          },
        },
      },
    },
  } satisfies OpenAPIRouteSchema;

  async handle(): Promise<Response> {
    return this.success({ totalCents: 0, months: [] });
  }
}

const app = fromHono(new OpenAPIHono()).get('/api/projects/:id/finance', ProjectFinance);

export const routes = registerCrud(app, '/api/projects', {
  list: Projects.List,
  create: Projects.Create,
  read: Projects.Read,
  update: Projects.Update,
  delete: Projects.Delete,
});

export type AppType = typeof routes;

// Anywhere (browser, React Native, tests):
const client = hc<AppType>('https://api.example.com');

async function demo() {
  const created = await client.api.projects.$post({ json: { name: 'Casa', budgetCents: null } });
  if (created.status === 201) {
    const body = await created.json(); // { success: true; result: { id; name; budgetCents; createdAt } }
    body.result.id;
  }

  const finance = await client.api.projects[':id'].finance.$get({
    param: { id: 'p1' },
    query: { month: '2026-09' },
  });
  const summary = await finance.json(); // { success: true; result: { totalCents; months } }
  summary.result.totalCents;
}
```

## What the client sees

| Route kind | Request (`input`) | Response (`output`, per status) |
|---|---|---|
| `app.get(path, RouteClass)` | `schema.request`: `params` → `param`, `query`, `headers` → `header`, `cookies` → `cookie`, JSON body → `json`, multipart / URL-encoded body → `form` | every JSON response in `schema.responses`, keyed by status; `Date` fields become strings (`JSONParsed`) |
| class without a schema | path params only | unknown body, any status |
| `registerCrud` — `create` | `json: meta.fields` (or a partial of the row) | `201 { success: true, result: Row }`, `400` error |
| `list` | optional `query` (`page`, `per_page`, `sort`, `order`, `search`, `include`, `fields`, `cursor`, filters) | `200 { success: true, result: Row[], result_info }`, `400` |
| `read` | `param.id`, optional `include`/`fields` | `200 { result: Row }`, `404` |
| `update` | `param.id`, `json: Partial<create body>` | `200`, `400`, `404` |
| `delete` | `param.id` | `200 { result: { deleted: true } }`, `404`, `409` |
| `restore`, `clone`, `upsert`, `search` | as generated | as generated |
| batch / aggregate / export / import / bulk-patch / versions | path only | unknown body |

Errors follow the shared envelope `{ success: false, error: { code, message, details? } }`
(`ErrorEnvelope`), so a client can narrow on `body.success`.

## Several resources at once

`registerCrud` calls in separate statements cannot accumulate one type; fold
them with `registerCrudResources` (imports as above):

```ts
const multi = registerCrudResources(fromHono(new OpenAPIHono()), {
  '/api/projects': { list: Projects.List, read: Projects.Read },
  '/api/archive': { list: Projects.List },
});

export type MultiAppType = typeof multi;
```

## Deriving your own types

`InferRequestType` and `InferResponseType` (from `hono/client`) read the
shapes back out of the client:

```ts
const api = hc<AppType>('https://api.example.com');

export type Project = InferResponseType<typeof api.api.projects.$get, 200>['result'][number];
export type CreateProject = InferRequestType<typeof api.api.projects.$post>['json'];
export type FinanceSummary = InferResponseType<
  (typeof api.api.projects)[':id']['finance']['$get'],
  200
>['result'];
```

## Keeping server-only types out of the client bundle

The exported `AppType` carries the app's `Env` (bindings, variables). If the
client is compiled in a project that lacks those ambient types (a React
Native app and Cloudflare Workers bindings, for instance), strip the `Env`
and keep only the schema:

```ts
import type { Hono } from 'hono';
import type { Schema } from 'hono/types';

export type ClientAppType = AppType extends Hono<infer _E, infer S extends Schema, infer P extends string>
  ? Hono<Record<string, never>, S, P>
  : never;
```

## Custom response envelopes

A `responseEnvelope` passed to `registerCrud` reshapes every body at runtime,
so the client cannot know the shape: those routes keep their typed inputs but
their outputs degrade to `unknown`.

## Testing with the client

`hc` accepts a custom `fetch`, so the same client drives the app in tests
without a server:

```ts
const test = hc<AppType>('http://localhost', { fetch: routes.request });

async function smoke() {
  const res = await test.api.projects.$get();
  return res.status; // 200 | 400
}
```
