---
"hono-crud": patch
---

OpenAPI: document `?include=` relations in List/Read responses.

When a List/Read endpoint has `allowedIncludes` and an included relation declares
a `schema` (the related model's shape), that relation is now added to the response
**item** schema as an OPTIONAL field — `hasMany` → array, `belongsTo`/`hasOne` →
nullable object. Previously a relation's `schema` was used only for internal
response typing and never reached the generated OpenAPI document, so consumers of
generated typed clients had to hand-type the embedded relation.

Backward-compatible and opt-in: relations without a `schema` (or endpoints without
`allowedIncludes`) are unchanged. Adds the internal helper `withIncludableRelations`.
