---
"hono-crud": patch
---

feat(events): emit events from all mutation verbs

`emitEvent` previously fired only on create/update/delete/restore. Every other
mutation verb was silent: upsert, clone, import, bulk-patch and the batch writes
(batch-create/update/delete/restore/upsert) mutated rows without notifying any
subscriber or webhook. They now emit at the same lifecycle position the original
four use (right after the audit-log call, before the finalize/serialize tail,
scheduled through `runAfterResponse`), carrying the decrypted in-memory record
so subscribers see a uniform plaintext stream regardless of which verb wrote the
row.

The `CrudEventType` union (a public type, re-exported from `hono-crud/events`
and consumed by the webhook `table:type` filter) gains nine past-tense members:
`upserted`, `cloned`, `imported`, `bulk_patched`, and `batch_created` /
`batch_updated` / `batch_deleted` / `batch_restored` / `batch_upserted`.

- **Per-record fan-out.** `CrudEventPayload.recordId`/`data` are singular, so the
  batch verbs (and import / bulk-patch) emit one event PER record — exactly as
  audit fans out one entry per record via `logBatchAudit`. A new
  `emitBatchEvents` helper on the endpoint base mirrors that audit helper.
- **Create-vs-update distinction.** `upserted` and `batch_upserted` carry
  `metadata.created`; `imported` carries `metadata.status` (`created`/`updated`).
- **Delete snapshots.** `deleted` / `batch_deleted` carry the record under
  `previousData`.
- **bulk-patch** emits only when the adapter surfaces the patched rows (the
  singular `recordId` payload cannot represent a count-only UPDATE).
