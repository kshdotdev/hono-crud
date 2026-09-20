---
'hono-crud': patch
'@hono-crud/drizzle': patch
---

Cloudflare ergonomics:

- `hono-crud/cloudflare` exports `runAfterResponse(ctx, promise)` and `createAfterResponse(ctx)` — background work that outlives the response on every runtime (`executionCtx.waitUntil` on Workers, in-band with logged rejections elsewhere). `OpenAPIRoute.runAfterResponse` now delegates to the same implementation.
- Health checks receive the request context (`check: async (c) => …`), so a readiness probe can reach `c.env` bindings; `createHealthRoutes<Env>` is generic over the app's Env. Zero-argument checks keep working.
- `AuthType` gains `'session'` for sessions resolved by an external auth library and mapped with `setAuthContext`.
- `sqliteAuditLogTable()` and `sqliteVersionHistoryTable()` now ship the indexes their storages' lookups need (`(table_name, record_id)` + `(timestamp)`; `(resource_table, record_id, version)`) and accept an `extraConfig` callback for more.
- New `docs/cloudflare.md`: wrangler template, per-request binding injection, column conventions that keep D1 happy, and the D1/KV limits to design around.
