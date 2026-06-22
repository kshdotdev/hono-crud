---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
---

Owner-scope relation includes (`?include=`) — security fix for cross-tenant exposure.

Previously, loading a relation via `?include=` fetched the related rows by foreign key alone, ignoring the **related** model's access scope. A caller who could read a parent row could therefore read a related row in another tenant (or a soft-deleted one) through the include — a cross-tenant data leak.

Relations can now declare a `scope` naming the related table's owner and soft-delete columns:

```ts
relations: {
  post: {
    type: 'belongsTo', model: 'posts', table: posts,
    foreignKey: 'postId', localKey: 'id',
    scope: { tenantField: 'authorId', softDeleteField: 'deletedAt' },
  },
}
```

When set, included related rows are filtered to the request's resolved tenant id and exclude soft-deleted rows (unless `?withDeleted=true`), so a foreign key pointing at another tenant's row resolves to `null` (belongsTo/hasOne) or is omitted (hasMany). The filtering lives in the core orchestrator (`batchLoadRelations` / `loadRelationsForItem`), so it applies identically across the drizzle, memory, and prisma adapters; the endpoint threads the parent request's tenant id + `withDeleted` into `IncludeOptions.scope` (Read via core; List via each adapter).

New public types: `RelationScopeConfig`, `RelationRequestScope`; new fields `RelationConfig.scope` and `IncludeOptions.scope`; new protected `getRelationScope()` on the endpoint base class.

Backward-compatible and opt-in: relations without `scope` (or requests that resolve no tenant) behave exactly as before. Declare `scope` on any relation whose related model is access-scoped to close the leak.

Note: scoping is applied as a post-fetch filter in the orchestrator (related rows are fetched, then filtered before being mapped back onto the parent — they never reach the response), not yet pushed down to the adapter `WHERE`/`where`. Correct and leak-free; pushing the predicate into the query is a performance follow-up.
