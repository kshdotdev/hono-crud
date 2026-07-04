---
'hono-crud': patch
---

Single-source closed unions and exhaustive lookup maps: `ActionSource`/`PendingActionStatus`, `ImportMode`/`ImportRowStatus`, and `ExportFormat` are now derived from exported `as const` tuples shared with their Zod validators (new exports: `ACTION_SOURCES`, `PENDING_ACTION_STATUSES`, `IMPORT_MODES`, `IMPORT_ROW_STATUSES`, `EXPORT_FORMATS`); the logging memory-storage sort switch and the aggregate field-restriction switch are replaced with `satisfies Record<...>` maps so adding a union member without handling it fails to compile instead of silently no-oping.
