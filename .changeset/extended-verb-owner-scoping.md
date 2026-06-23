---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
---

fix(security): scope aggregate/search/export/bulk-patch verbs to the caller's tenant

`GET /resource/aggregate`, `GET /resource/search`, `GET /resource/export`, and
`PATCH /resource/bulk` built their WHERE clause from the parsed request filters
**without** applying the model's `multiTenant` owner filter. Only `ListEndpoint`
re-applied the tenant scope in its handler; these four verbs did not (and
`ExportEndpoint` overrides `ListEndpoint.handle`, so it didn't inherit it). A
caller could therefore aggregate, search, export, or bulk-patch across **every
tenant's rows**, regardless of `Model.multiTenant`.

Owner-scoping is now centralized in a single auditable core helper,
`applyTenantScope` (plus `applyTenantScopeToAggregateFilters` for the aggregate
`Record`-shaped WHERE), which `ListEndpoint` and all four verbs call after
parsing filters and before running the query. Each verb now enforces tenant
presence (`validateTenantId`, 400 `TENANT_REQUIRED` when required) and ANDs the
owner equality into the adapter WHERE — so a tenant's aggregate counts, search
hits, export rows, and bulk-patch matches are confined to its own rows.

A second leak on the same verbs is also closed: `search` and `export` loaded
`?include=` relations WITHOUT the owner `scope` that `list`/`read` pass, so an
embedded related row could cross tenants even when the parent rows were scoped.
All three adapters (drizzle, memory, prisma) now thread `getRelationScope(...)`
into the search/export relation loader, matching List.

Covered by a new cross-adapter conformance cell (`extended-verb-tenant-scoping`)
asserting per-tenant aggregate counts (incl. a grouped aggregation), search /
export / bulk-patch isolation, the `TENANT_REQUIRED` contract, AND that
`?include=` on search/export never embeds another tenant's related row — across
the memory and drizzle legs.
