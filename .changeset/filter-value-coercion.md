---
'hono-crud': patch
---

Query-string filter values are now coerced to the model's declared zod kind before reaching the adapter: `z.number()` fields get numbers, `z.boolean()` fields get booleans (`true`/`1` / `false`/`0`), `z.date()` fields get `Date`s (array operators `in`/`nin`/`between` elementwise; `like`/`ilike` keep the raw string; wrappers such as `.optional()`, `.nullable()`, `.default()` and `z.preprocess`/`.transform` pipes are unwrapped). A value that cannot be coerced (`?age[gte]=abc`, `?done=maybe`) is a 400 `VALIDATION_ERROR` instead of a silent no-match. This fixes typed Drizzle column modes on SQLite/D1, where `integer({ mode: 'boolean' })` read the string `"false"` as truthy and `integer({ mode: 'timestamp' })` threw on a string. `ListFilterParseOptions` gains `fieldSchemas` (the model's `schema.shape`); the list, search and bulk-patch endpoints pass it automatically.
