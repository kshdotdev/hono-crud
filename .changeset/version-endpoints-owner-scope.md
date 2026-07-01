---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/memory": patch
---

Fix a cross-tenant data leak in the version endpoints. `versionHistory`,
`versionRead`, `versionCompare`, and `versionRollback` did not apply the model's
`multiTenant` owner-scope, so any authenticated user who knew a record id could
read (or roll back) another tenant's version history — while the base CRUD reads
correctly 404'd. All four endpoints now gate on a tenant-scoped `recordExists`
(the parent record must exist AND belong to the caller's tenant), matching base
reads; owning the record implies owning its versions since record ids are
unique. New `CrudEndpoint#getTenantScope()` helper; the Drizzle and Memory
adapters scope their existence check by the tenant field.
