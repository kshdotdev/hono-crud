---
'hono-crud': patch
---

Typed RPC client support: apps built with `fromHono` now accumulate Hono's route `Schema` generic, so `hc<typeof app>` from `hono/client` (and `InferRequestType` / `InferResponseType`) work against hono-crud routes.

- `fromHono(new OpenAPIHono<Env>())` returns `HonoOpenAPIApp<E, S, BasePath>`; every `app.<verb>(path, RouteClass)` call folds the class's schema entry into `S`. Request types are derived from the class's `schema.request` (`params` → `param`, `query`, `headers`, `cookies`, a JSON body → `json`, a multipart/URL-encoded body → `form`) and response types from every JSON response declared in `schema.responses`, narrowed by status code (`Date` fields are JSON-parsed to strings). Declare the property as `schema = { … } satisfies OpenAPIRouteSchema` (or build it with the new `defineRouteSchema` helper) so status keys and zod identities stay literal; a class without a schema still appears in the client with an unknown body.
- `registerCrud(app, basePath, endpoints)` returns the app typed with the CRUD routes it registered (transcribed from each verb's generated OpenAPI schema: create 201/400, list 200 + `result_info`, read 200/404, update 200/400/404, delete 200 `{ deleted: true }`/404/409, restore, clone, upsert, search; the remaining verbs are present with an unknown body). Row types come from the endpoint's `_meta.model.schema`; create/update bodies from `meta.fields` when declared, otherwise a partial of the row. A custom `responseEnvelope` degrades outputs to `unknown`. The return value may still be ignored.
- New `registerCrudResources(app, { [basePath]: endpoints })` registers several resources and returns one accumulated type — the statement-style `registerCrud` calls cannot accumulate across statements.
- `defineMeta({ model, fields })` now keeps the `fields` zod type on the result (`DefinedMeta`), which is what gives create bodies a precise client type.
- Class routes written against a custom `Env` (`class X extends OpenAPIRoute<{ Bindings: … }>`) register through the typed verb overloads on the matching app: the internal route-class constraint no longer pins `setContext` to the default `Env`.
- `errorResponses({ 404: '…' })` is now typed by the literal statuses of its map, so `InferResponseType<…, 404>` resolves to the error envelope instead of a `number`-status entry.
- New exported types: `SuccessEnvelope`, `PaginatedEnvelope`, `ErrorEnvelope`, `ResultInfo`, `CrudSchema`, `CrudResourcesSchema`, `CrudRow`, `CrudCreateInput`, `CrudUpdateInput`, `CrudListQuery`, `CrudReadQuery`, `CrudSearchQuery`, `RouteClassEntry`, `RouteClassSchema`, `RouteSchemaInput`, `RouteSchemaOutput`, `ToHonoPath`, `EnvelopeKindOf`, and friends.

Hono's own verb overloads (plain handlers) are matched first and return Hono's type, so register class routes / CRUD resources before plain handlers when chaining, or keep them in separate statements.
