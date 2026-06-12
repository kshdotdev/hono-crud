---
"@hono-crud/cache": patch
"@hono-crud/rate-limit": patch
"@hono-crud/idempotency": patch
"@hono-crud/memory": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
"@hono-crud/mcp": patch
---

`hono-crud` is now a peerDependency (caret range) instead of an exact-pinned dependency. Previously, published packages pinned the exact core version (e.g. `0.13.13`), so an app on any other core version got two physical copies of `hono-crud` installed — silently corrupting satellite exception codes through `createErrorHandler` (e.g. `RATE_LIMIT_EXCEEDED` degraded to `HTTP_ERROR`, `details.retryAfter` dropped) and breaking `setLogger()` for all adapter logging. The resolver now dedupes onto the app's single copy. npm >= 7 and pnpm >= 8 auto-install peers, so installs are unchanged.
