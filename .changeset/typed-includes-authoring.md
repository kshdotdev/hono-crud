---
'hono-crud': patch
---

Typed relation names at the authoring surfaces: builder `.include()` / `.nestedCreate()` / `.nestedWrites()`, functional `allowedIncludes` / `allowNestedCreate` / `allowNestedWrites`, and config-API `includes` / `nestedCreate` / `nestedWrites` now take `RelationNamesOf<M>[]` — a typo'd relation name is a compile error when the meta was authored through `defineModel`/`defineMeta`, and degrades to permissive `string` for un-narrowed generic wrappers. Parameter positions only: nothing narrows past `.build()`, generated classes and runtime `?include=` handling (unknown names silently skipped) are byte-identical.
