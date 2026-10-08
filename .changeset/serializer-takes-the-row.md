---
'hono-crud': patch
---

`Model.serializer` now receives the stored row instead of the public schema type. With a Drizzle `table`, the row is `table.$inferSelect`, so a serializer can read columns the schema leaves out (`row.r2Key`) and JSON text columns as the strings they are, without an `as unknown as` cast. Models without a Drizzle table (schema-only, Prisma's delegate-name string) keep the schema type. New `InferModelRow<typeof Model>` names that row. Migration: a serializer whose parameter is annotated with the schema type fails to compile when the row and schema disagree; drop the annotation or annotate it with `InferModelRow<typeof Model>`.
