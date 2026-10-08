---
'hono-crud': patch
---

Keep a named model's OpenAPI component `$ref` when `?include=` relations are documented (#150).

A model schema named with `.meta({ id })` now emits `allOf: [{ $ref }, { <relations> }]` on List/Read responses instead of an anonymous inlined row, so generated clients get the same named type on every verb. A `z.strictObject` or typed `.catchall()` model keeps the inlined row, as does a model with a field named like an included relation: its component's `additionalProperties` would reject the relation fields, or `allOf` would intersect the field with the relation (a `z.looseObject` / `.passthrough()` one keeps the `$ref`). The includable relations are also now documented on Search and Export responses, which already loaded them at runtime.

A to-one (`belongsTo`/`hasOne`) relation whose schema is named with `.meta({ id })` is documented as `anyOf: [{ $ref }, null]` rather than a nullable wrapper, which could otherwise mark the related model's shared component itself as nullable depending on route registration order. On the 3.0 generator (`app.doc()`, which the README uses) that null branch is a bare `{ nullable: true }`, which typed-client generators such as openapi-typescript and hey-api read as `unknown`; `app.doc31()` emits `{ type: 'null' }`. Relation schemas without a `.meta({ id })` name keep the nullable object.
