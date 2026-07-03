---
"@hono-crud/cache": patch
---

Fix a cache-collision bug in the `withCache` mixin's key generation. The cache
package carried a stale, diverged copy of the key generator that dropped the
response-shaping query params (`fields`/`include`) from the cache key whenever
`keyFields` was configured. Two requests differing only in `?fields=`/`?include=`
would then collide on one cached body, serving the wrong field selection.

The cache package now imports the canonical generator + invalidation-pattern
helpers from core (via `hono-crud/internal`), so the mixin and the config-API
cache path share ONE key format that always keeps `fields`/`include` in the key.
`parseCacheKey` remains exported from `@hono-crud/cache` (it is owned solely by
this package); no public API was removed.
