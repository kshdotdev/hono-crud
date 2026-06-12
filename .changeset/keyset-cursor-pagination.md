---
"hono-crud": patch
"@hono-crud/memory": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
---

Cursor pagination is now real on all three adapters. Previously core advertised cursor query params and `next_cursor`/`prev_cursor` response fields, but only the memory adapter implemented them — Drizzle and Prisma silently fell back to offset pagination.

- **Drizzle**: keyset via `WHERE cursorField > decoded ORDER BY cursorField LIMIT n+1`; **Prisma**: native `cursor` + `skip: 1` + `take: n+1`. All three adapters build the cursor-mode `result_info` envelope through one shared core helper, so the shape is byte-identical.
- **`prev_cursor` removed** (breaking): cursor walks are next-only (Stripe-style) — SQL keyset "previous" requires a reversed query and was only ever implemented in memory.
- **`order_by` is forced to the cursor field during cursor walks** (documented on the query param) — previously the three adapters could diverge on sort semantics mid-walk.
- **No silent degradation**: cursor query params and `next_cursor` only appear in the OpenAPI schema when the endpoint enables cursor pagination AND the adapter supports it; enabling it on an unsupporting adapter throws `ConfigurationException` instead of quietly serving offset pages.
- List-query logic deduplicated per adapter (`executeDrizzleListQuery` / memory store query helper, mirroring Prisma's existing `executePrismaQuery`) and batch OpenAPI scaffolding shared by the three id-keyed batch verbs.
