---
"hono-crud": patch
---

feat(config): expose keyset (cursor) pagination through the list config API

`ListEndpointConfig.pagination` now accepts `cursor: { enabled, field }`, so
config-based consumers can opt into keyset pagination without subclassing an
endpoint. `defineEndpoints` forwards it to the generated endpoint as
`cursorPaginationEnabled` / `cursorField`. `supportsCursorPagination` stays
adapter-owned, so enabling cursor on an adapter without keyset support still
throws the loud `ConfigurationException` (no silent fallback to offset). Default
cursor field is `id`.
