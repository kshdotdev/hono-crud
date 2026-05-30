---
"hono-crud": patch
---

Internal refactor: deduplicate endpoint read-shaping, centralize context keys, and type the config "extras" bridge.

- **Fix (security):** `restore`, `search`, `clone`, `upsert`, and the batch endpoints now apply `model.serializationProfile` to their responses. Previously they serialized records without it, leaking fields the profile was meant to strip. If you relied on those endpoints returning profile-excluded fields, update your expectations.
- Endpoint output shaping (computed fields → serializer → serialization profile → transform → field selection) is now a single shared pipeline (`finalizeRecord` / `finalizeArray`) instead of being copy-pasted per endpoint.
- Centralized the Hono context-variable keys behind `CONTEXT_KEYS` and removed several internal deprecation shims; public exports are unchanged.
- The config-API "extras" for extended verbs are now compile-time typed, so a misspelled option key is a build error instead of being silently ignored.
- **Breaking (types):** the parser-side `ListEndpointConfig` type export was renamed to `ListFilterParseOptions`. The config-API list type is unchanged (still exported as `ConfigListEndpoint`). `ModelObject` is retained as a deprecated alias of `InferModel`.
- Added `hono-crud/config` and `hono-crud/functional` subpath exports (parity with the other feature modules).
- `registerCrud` now accepts `bulkPatch`, `versionHistory`, `versionRead`, `versionCompare`, and `versionRollback` slots, wiring them to their conventional routes instead of requiring manual `app.patch`/`app.get` calls.
