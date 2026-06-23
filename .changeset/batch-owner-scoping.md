---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
---

fix(security): scope batch verbs to the caller's tenant

`batchDelete`, `batchUpdate`, and `batchRestore` operated on a client-supplied
id list without applying the model's `multiTenant` owner filter — unlike the
single-row verbs, which get it via core-injected `additionalFilters`. A caller
could delete, update, or restore **another tenant's rows** by passing their ids.

Core now enforces tenant presence in each batch handler (`validateTenantId`,
400 `TENANT_REQUIRED` when required), and exposes `getTenantScopeFilter()` which
each adapter ANDs into its batch WHERE (drizzle/memory) or `findMany` lookup
(prisma). Cross-tenant ids now fall through to `notFound`; the row is untouched.

Covered by a new cross-adapter conformance cell (`batch-tenant-scoping`).
