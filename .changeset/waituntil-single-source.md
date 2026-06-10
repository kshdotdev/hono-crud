---
"hono-crud": patch
---

Consolidate the three divergent `executionCtx.waitUntil` helpers onto one guarded implementation (breaking, patch). The public `getWaitUntil` exported from `hono-crud/cloudflare` no longer throws outside a Workers runtime — it now returns `WaitUntil | undefined` like the internal helper always did. `OpenAPIRoute.runAfterResponse` reuses the shared `getWaitUntil` from `utils/wait-until` instead of an inlined copy, and the dead thunk-based `runAfterResponse` free function was removed.
