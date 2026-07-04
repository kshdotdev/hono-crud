---
'hono-crud': patch
---

Add `defineModels` — an eager model-registry factory where cross-referencing models are authored in one call and reference each other by sibling registry key. Circular graphs (User↔Post) become inert data with no declaration-ordering games; each relation's `schema`/`table` is auto-populated from its target sibling (closing the silent OpenAPI-include and drizzle-include gaps), the authored registry key is rewritten to the target's `tableName` for the adapters, and unknown targets fail fast with one aggregated setup-time error carrying a did-you-mean suggestion. Relation `model` references are compile-time constrained to the sibling keys; off-registry targets opt out per relation via `external: true`. Configurable via `DefineModelsConfig` (`autoPopulateSchema`, `autoPopulateTable`, `overwriteExplicit`, `onUnknownModel`, `freeze`).
