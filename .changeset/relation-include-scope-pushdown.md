---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
---

Push owner-scoped relation includes (`?include=`) down to the adapter query.

The owner-scope filter on relation includes ran as a **post-fetch** filter in the
core orchestrator: related rows were fetched by foreign key, then cross-tenant /
soft-deleted ones were dropped before the response. Now the resolved scope (tenant
column + value, soft-delete column) is threaded into each adapter's `fetchRelated`,
so the filter is pushed into the **WHERE clause** (drizzle / prisma) or the store
scan (memory) — the disallowed rows are never fetched. The core orchestrator keeps
its post-fetch `applyRelationScope` as a defense-in-depth net for adapters that
ignore the scope argument.

Adds the internal `RelationFetchScope` type + `resolveFetchScope`; the
`FetchRelated` / `SyncFetchRelated` types gain an optional 4th `scope` argument
(backward-compatible — a 3-arg adapter `fetchRelated` stays assignable). Also adds
a cross-adapter relation-scoping conformance cell (runs on memory + drizzle; a
named skip on the prisma leg, whose fixed examples schema has no self-relation).
