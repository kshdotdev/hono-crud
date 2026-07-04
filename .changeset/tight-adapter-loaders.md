---
'@hono-crud/drizzle': patch
'@hono-crud/prisma': patch
'@hono-crud/memory': patch
---

Adapter tightening: drizzle's lazy drizzle-zod loader now has a non-null return type — the 10 caller-side `!` assertions are gone, and a concurrent first call no longer crashes on a not-yet-populated cache (it re-imports idempotently); `getTable` throws `ConfigurationException` (500 `CONFIGURATION_ERROR` envelope) instead of a plain `Error` for a model without a table reference, per the error-split doctrine; the drizzle/prisma connection duck-types use an honest `(key: string)` context getter instead of `(key: never)` + `as never` casts; memory's `queryMemoryStore`/`findByUpsertKeys` are bounded `<T extends Record<string, unknown>>`, removing seven internal widening casts.
