---
"hono-crud": patch
---

Internal: complete the OpenAPI metadata migration to Zod v4's `.meta()` registry — the remaining `.describe()` calls (read/export/import endpoint query parameters) now use `.meta()`, so the entire core no longer uses `.describe()`. The OpenAPI snapshot fixture was expanded to cover the export/import endpoints, and the generated output is unchanged (the snapshot is byte-for-byte identical after the migration). No consumer-facing change.
