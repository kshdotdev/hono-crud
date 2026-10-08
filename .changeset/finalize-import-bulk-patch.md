---
'hono-crud': patch
---

Import results and bulk-patch `records` now run the shared finalize chain (computed fields, serializer, projection, serialization profile, `transform`) like every other record-returning verb. Both used to return the decrypted stored row as-is, so a column the schema leaves out, or a field the serialization profile strips, reached the client through `POST /import` and `PATCH /bulk` with `returnRecords`. Events and `after` hooks still receive the stored row. Migration: a client that read an undeclared column from these responses must have it declared in the schema or added as a computed field. The protected `CrudEndpoint.applyProfileToArray` is removed; a subclass that called it should use `finalizeArray` (the whole chain) or map `applyProfile` over its records.
