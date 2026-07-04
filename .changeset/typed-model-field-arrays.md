---
'hono-crud': patch
---

Model field arrays are schema-key-checked: `softDelete.field`, `multiTenant.field`, `audit.excludeFields`, `versioning.field`/`excludeFields`, `fieldEncryption.fields`, `timestamps.createdAt`/`updatedAt`, and `computedFields[*].dependsOn` now reject names that aren't keys of the model's Zod schema (each sub-config gains a defaulted `TField extends string = string` generic, so bare references and non-model uses are unchanged; `historyTable`, `contextKey`, `pathParam`, `headerName`, `queryParam` deliberately stay `string`). New `ComputedFieldReturns<C>` helper types the read-side shape computed fields add to responses. Known reuse cliff (documented in JSDoc + pinned by a type test): a variable annotated with a bare sub-config type widens to `string` and no longer assigns into a model slot — inline the object or annotate with your schema-key union; the row-typed `ComputedFieldsConfig<Row>` reuse pattern keeps compiling.
