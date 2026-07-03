---
"@hono-crud/memory": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
"hono-crud": patch
---

Add `createMemoryCrud(meta)` — the in-memory sibling of `createDrizzleCrud`/`createPrismaCrud`. It returns CRUD endpoint base classes with `_meta` pre-stamped (memory has no `db` to bind), so class-based endpoints drop the per-class `_meta` restatement.

All three CRUD factories now default each endpoint's OpenAPI `tags` from the model's `tag` (falling back to `tableName`), matching the sugar path (`defineEndpoints`/builder/functional). An explicit non-empty `schema.tags` on a subclass still wins, so existing explicitly-tagged endpoints are byte-identical. Set `tag` on the model (`defineModel({ tableName: 'users', tag: 'Users', ... })`) to keep a capitalized display group without repeating it on every endpoint. The shared resolution lives in one place and is exposed to the adapter packages via `hono-crud/internal` as `resolveSchemaTags`.
