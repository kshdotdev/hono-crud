---
'hono-crud': patch
---

The response projection now also covers the record paths that skipped the finalize chain. Export (JSON and CSV, buffered and streamed) keeps only the response fields, minus `excludedExportFields`. Version history, version read and version compare project each snapshot's `data` and `changes`; rollback runs the full finalize chain (computed fields, serializer, projection, profile, `transform`) instead of the serializer alone. Batch upsert projects after its serializer. Rows attached by `?include=`, on export as on every other read, are projected onto the relation's `schema` when it declares one (`defineModels` fills it in by default); a relation without a `schema` documents no shape and passes through unchanged.
