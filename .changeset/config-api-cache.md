---
"hono-crud": patch
"@hono-crud/cache": patch
---

feat(config): config-API response caching with invalidation

`endpoints.{list,read}.cache` enables response caching (X-Cache MISS→HIT) and
`endpoints.{create,update,delete}.cache.invalidate` busts it — all through the
config API, no subclassing. Core now owns the cache code path (key format,
`CacheConfig`, the cache-storage feature); `@hono-crud/cache` re-exports the
storage feature so the `withCache` mixin and the config path share ONE storage
global.

Cache keys are tenant-scoped automatically on multiTenant resources, so a
cached page is never served across tenants; invalidation uses the same
tenant-scoped prefix. Storage resolves from request context
(`createCacheStorageMiddleware`) or the global `setCacheStorage`.
