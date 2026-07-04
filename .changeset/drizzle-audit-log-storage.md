---
"@hono-crud/drizzle": patch
"hono-crud": patch
---

Add `DrizzleAuditLogStorage` — a durable, Drizzle-backed `AuditLogStorage` (Cloudflare D1, libsql, postgres-js, …) so audit logs survive across isolates/requests. Previously the only shipped `AuditLogStorage` was in-memory, so audit history on Workers was per-isolate and ephemeral. Ships a `sqliteAuditLogTable()` helper for D1/SQLite; one shared table backs many models (rows discriminated by the model's tableName). Semantics track `MemoryAuditLogStorage` exactly: `getAll` combines every filter (tableName, action, userId, date range) with AND, the date range is inclusive on both ends, results are oldest-first, and `limit`/`offset` slice the result. Core re-exports `AuditLogEntry`, `AuditAction`, and `AuditFieldChange` from `hono-crud/audit` so storage implementers can import them alongside the `AuditLogStorage` interface.
