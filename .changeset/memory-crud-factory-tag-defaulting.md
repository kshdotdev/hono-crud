---
"@hono-crud/memory": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
"hono-crud": patch
---

Add `createMemoryCrud(meta)` — the in-memory sibling of `createDrizzleCrud`/`createPrismaCrud`. It returns CRUD endpoint base classes with `_meta` pre-stamped (memory has no `db` to bind), so class-based endpoints drop the per-class `_meta` restatement.

OpenAPI `tags` now default from the model's `tag` (falling back to `tableName`) for **every** endpoint definition style — the sugar path (`defineEndpoints`/builder/functional), the adapter CRUD factories (`createMemoryCrud`/`createDrizzleCrud`/`createPrismaCrud`), and plain hand-written class-based endpoints. Defaulting happens once, at route registration, so declaring `tag` on the model (`defineModel({ tableName: 'users', tag: 'Users', ... })`) sets a capitalized display group that every surface honors — the live `/openapi.json`, `buildPerTenantOpenApi`, and `toOpenApiPaths` — without repeating `tags` on each endpoint. An explicit non-empty `schema.tags` always wins, so existing explicitly-tagged endpoints are byte-identical.
