---
"@hono-crud/drizzle": patch
"hono-crud": patch
---

Add `DrizzleVersioningStorage` — a durable, Drizzle-backed `VersioningStorage` (Cloudflare D1, libsql, postgres-js, …) so record version history survives across isolates/requests. Previously the only shipped `VersioningStorage` was in-memory, so version history on Workers was per-isolate and ephemeral. Ships a `sqliteVersionHistoryTable()` helper for D1/SQLite; one shared table backs many models (rows discriminated by the model's tableName). Core re-exports `VersionHistoryEntry` from `hono-crud/versioning` so storage implementers can import it alongside `VersioningStorage`.
