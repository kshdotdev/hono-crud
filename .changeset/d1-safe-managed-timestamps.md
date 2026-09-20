---
'hono-crud': patch
'@hono-crud/drizzle': patch
---

Engine-managed timestamps are now written in the representation each column declares, which makes soft delete and `Model.timestamps` safe on Cloudflare D1 (whose `bind()` rejects objects). Core gains a `managedTimestampValue(field)` hook on `CrudEndpoint` (default `Date.now()`, unchanged for the memory and Prisma adapters) that `applyManagedInsertFields` / `applyManagedUpdateFields` call for `createdAt` / `updatedAt`. The Drizzle adapter overrides it on every write verb — and uses the same rule for the soft-delete marker, which used to bind `new Date()` unconditionally — reading the Drizzle column's `dataType`: `date` columns (`timestamp()`, `integer({ mode: 'timestamp' | 'timestamp_ms' })`) get a `Date`, `number` columns get epoch milliseconds, `string` columns get an ISO-8601 string. New exports: `resolveTimestampValue`, `resolveTimestampRepresentation`, `TimestampRepresentation`.
