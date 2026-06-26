---
"@hono-crud/idempotency": patch
---

Add a Cloudflare Durable Objects backend for idempotency: `DOIdempotencyStorage` + `IdempotencyDurableObject`.

KV has no compare-and-swap, so it can't back an atomic idempotency `lock()` — which is why there was deliberately no KV backend. A Durable Object can: each idempotency key maps to its own DO instance (`idFromName(key)`), so different keys never contend while concurrent requests for the *same* key serialize, and the lock compare-and-set runs inside `blockConcurrencyWhile` for true CAS. This is the edge-native backend Workers users can use instead of Upstash Redis.

Wiring: export `IdempotencyDurableObject` from your Worker entry, declare the DO binding + a migration in `wrangler.toml`, then `setIdempotencyStorage(new DOIdempotencyStorage(env.IDEMPOTENCY))` (or inject via `createStorageMiddleware`) and add `createIdempotencyMiddleware()`. Types are structural (no `@cloudflare/workers-types` dependency).
