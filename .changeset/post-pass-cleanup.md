---
"hono-crud": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
---

refactor: single-source tag defaulting, drop dead totalPages, short-circuit batch events

Post-pass cleanup — three internal tightenings with no change to emitted OpenAPI,
response envelopes, or events.

**Single-source OpenAPI tag defaulting (core).** The sugar-class factory
(`generateEndpointClass`) no longer bakes the model-group tag default into the
generated class's raw `schema` field. Tag defaulting (`Model.tag` ?? `tableName`,
explicit `openapi.tags` always wins) is now applied at exactly one place — the
emit-time choke point `resolveInstanceSchemaTags`, already used by `registerRoute`
and `buildPerTenantOpenApi`, and now also by `toOpenApiPaths`. Registered-route
and per-path OpenAPI emission are byte-identical. **Observable only to code
reading a generated class's raw `.schema` field (or `getSchema()`) directly:** it
now carries only explicitly supplied tags; the model-group default appears solely
in emitted output. `resolveSchemaTags` is no longer re-exported from
`hono-crud/internal` (no importer remained; the function stays in core).

**Dead `totalPages` dropped (drizzle, prisma).** `executeDrizzleListQuery` /
`executePrismaQuery` no longer compute or return `totalPages` on their offset
path — every call site builds the envelope's `total_pages` via core's
`buildOffsetPageInfo({ page, perPage, totalCount })`, so the executor value was
unread. Response output is unchanged.

**Batch-event no-op scheduling removed (core).** `emitBatchEvents` now resolves
the event emitter once per request and returns immediately when none is
configured, instead of scheduling a per-record `runAfterResponse` no-op. With an
emitter configured the emitted events, their order, and their `runAfterResponse`
dispatch are byte-identical (payload building moved verbatim into a shared
`dispatchEvent`); resolution semantics match the single-verb `emitEvent`
(per-request, never cached across requests).
