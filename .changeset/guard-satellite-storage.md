---
'@hono-crud/mcp': patch
'@hono-crud/rate-limit': patch
'@hono-crud/cache': patch
'@hono-crud/idempotency': patch
---

Satellite tightening: rate-limit adapters validate every value read back from external storage with shared `isFixedWindowEntry`/`isSlidingWindowEntry` guards (hoisted from the KV adapter) — malformed Redis/Lua/KV values fall through to safe paths instead of being cast into window entries; mcp's dispatch takes a structural `Dispatchable` instead of `Hono<any, any, any>` and throws `ConfigurationException` for an operation missing from the route table (was a destructure crash); mcp error messages narrow `unknown` errors honestly (a thrown string now surfaces its text instead of `undefined`); cache's tag index drops a non-null assertion via bucket binding and the invalidation-strategy switch gains an `assertNever` exhaustiveness default; the idempotency Durable Object rejects a malformed `set` message without an entry instead of persisting a corrupt record blessed by a cast.
