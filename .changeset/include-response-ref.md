---
'hono-crud': patch
---

Keep a named model's OpenAPI component `$ref` when `?include=` relations are documented (#150).

A model schema named with `.meta({ id })` now emits `allOf: [{ $ref }, { <relations> }]` on List/Read responses instead of an anonymous inlined row, so generated clients get the same named type on every verb. A `z.strictObject` or `.catchall()` model keeps the inlined row: its component's `additionalProperties` would reject the relation fields. The includable relations are also now documented on Search and Export responses, which already loaded them at runtime.

A to-one (`belongsTo`/`hasOne`) relation whose schema is named is documented as `anyOf: [{ $ref }, null]` rather than a nullable wrapper, which could otherwise mark the related model's shared component itself as nullable depending on route registration order. The 3.1 generator (`.doc31()`) emits that null branch as `{ type: 'null' }`; the 3.0 generator (`.doc()`) emits a bare `{ nullable: true }`, which typed-client generators read as `unknown`. Unnamed relation schemas keep the nullable object.
