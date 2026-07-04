---
'hono-crud': patch
---

Typed-relations foundation: `Model` and `MetaInput` gain a third defaulted generic `TRelations extends RelationsConfig` that preserves relation names as literal keys; `defineModel` infers it from the `relations` object (normalizing each value to the named `RelationConfig` reference so hovers and declaration emit stay flat) and `defineMeta` carries it through. New root-barrel helpers `RelationNamesOf<M>` and `FieldsOf<M>` expose the model's literal relation-name and schema-key unions for authoring surfaces; both degrade to permissive `string` on un-narrowed `MetaInput`. Backbone (endpoint classes, registrar, loaders, `NormalizedEndpointConfig`) is untouched — the default keeps every existing `Model`/`Model<T>`/`Model<T,TTable>` reference and heterogeneous collection compiling. Adds a `typecheck:types` compile-time assertion suite to the test chain.
