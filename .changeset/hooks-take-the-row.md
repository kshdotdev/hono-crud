---
'hono-crud': patch
'@hono-crud/drizzle': patch
'@hono-crud/memory': patch
'@hono-crud/prisma': patch
---

Read-side hooks and adapter methods are typed as the stored row (`InferModelRow`) instead of the public schema: every `after` hook (class, builder, functional and config APIs), clone's `before`, `computedFields[].compute`, `policies.read`/`write`/`fields`, and the adapter methods that read or return records (`read`, `list`, `search`, `findExisting`, `create`'s return, and the rest). A Drizzle `Delete.after(prior)` can read `prior.r2Key` without a cast. Request bodies, `before` hooks on create/update/upsert/import, and `transform` keep the schema type. Migration: overrides annotated with the schema type fail to compile where a Drizzle row differs from the schema (a `text` column behind a `z.enum`, a JSON text column behind `z.array`); annotate them with `InferModelRow<typeof Model>` or drop the annotation.
