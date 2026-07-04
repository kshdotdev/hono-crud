---
'hono-crud': patch
---

Add `defineModelsExtending` — compose `defineModels` registries acyclically across files/calls: a previously-wired base map's keys become referenceable siblings for a new map (compile-time checked across the combined keyspace), with the same auto-population, key→tableName rewrite, aggregated loud unknown-target error, and config knobs. Same-call siblings shadow base keys; base models are never re-wired, mutated, or frozen by the extending call.
