---
"hono-crud": patch
---

Internal: migrate the list/search query-parameter OpenAPI metadata from `.describe()` to Zod v4's `.meta()` metadata registry, and add a byte-for-byte OpenAPI snapshot test that guards the generated document against regressions. The emitted OpenAPI output is unchanged (the snapshot proves it) — this is a modernization to the canonical Zod v4 metadata API with no consumer-facing impact.
