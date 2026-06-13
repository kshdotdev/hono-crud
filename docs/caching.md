# Caching

Caching lives in the `@hono-crud/cache` package. It provides response caching via mixins (`withCache`, `withCacheInvalidation`) and supports Memory and Redis storage backends.

Install: `npm install @hono-crud/cache`.

---

## Setup

Caching requires a storage backend — there is **no implicit default**. When no
storage is configured, the mixins degrade to a no-op (every lookup is a miss)
and log a once-per-isolate warning.

Inject the storage through `createStorageMiddleware` — the recommended path,
especially on edge/serverless runtimes. It writes the `cacheStorage` context
var that the cache mixin resolves from:

```typescript
import { createStorageMiddleware } from 'hono-crud/storage';
import { MemoryCacheStorage } from '@hono-crud/cache';

app.use('*', createStorageMiddleware({
  cacheStorage: new MemoryCacheStorage(),
}));
```

### Redis Storage

```typescript
import { RedisCacheStorage } from '@hono-crud/cache';

app.use('*', createStorageMiddleware({
  cacheStorage: new RedisCacheStorage({
    client: redisClient,   // Any Redis client with get/set/del/keys
    prefix: 'cache:',      // Key prefix (default: 'cache:')
  }),
}));
```

### Global Storage (long-lived servers)

On a long-lived Node/Bun server you can set a module-global storage once
instead. Resolution priority is context > global, so the setter is a
compatibility option, never a requirement:

```typescript
import { setCacheStorage, MemoryCacheStorage } from '@hono-crud/cache';

setCacheStorage(new MemoryCacheStorage());
```

---

## withCache Mixin

Add caching to read/list endpoints:

```typescript
import { withCache } from '@hono-crud/cache';
import { MemoryReadEndpoint, MemoryListEndpoint } from '@hono-crud/memory';

class UserRead extends withCache(MemoryReadEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get user' };

  cacheConfig = {
    ttlSeconds: 300,    // 5 minutes
    perUser: false,     // Shared cache (true = per-user cache keys)
    tags: ['users'],    // Cache tags for targeted invalidation
  };

  async handle(ctx) {
    this.setContext(ctx);

    // Try cache first
    const cached = await this.getCachedResponse();
    if (cached) {
      return this.successWithCache(cached);
    }

    // Fetch from database
    const response = await super.handle(ctx);

    // Cache successful responses
    if (response.status === 200) {
      const data = await response.clone().json();
      await this.setCachedResponse(data.result);
    }

    return response;
  }
}
```

### Cache Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable caching |
| `ttlSeconds` | `number` | `300` | Time to live in seconds |
| `perUser` | `boolean` | `false` | Include userId in cache key |
| `tags` | `string[]` | `[]` | Cache tags for targeted invalidation |
| `keyFields` | `string[]` | - | Additional fields in cache key |
| `prefix` | `string` | - | Custom key prefix |

> **TTL units.** `cacheConfig.ttlSeconds` is **seconds** — the ergonomic, user-facing
> unit. The underlying storage contract works in **milliseconds**: the mixin
> converts once (`ttlSeconds * 1000`) before calling `CacheStorage.set(key, data, { ttlMs })`.
> If you implement a custom `CacheStorage`, its `set` receives `ttlMs`
> (milliseconds), not seconds.
>
> **Cloudflare KV floor.** KV's `expirationTtl` has a 60-second minimum, so
> `KVCacheStorage` silently floors short TTLs:
> `expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000))`. A sub-minute `ttlSeconds`
> therefore behaves as 60s on KV. This is a documented KV-platform constraint.

### Cache Methods

| Method | Description |
|--------|-------------|
| `getCachedResponse<T>()` | Get cached data (returns `null` on miss) |
| `setCachedResponse<T>(data)` | Store data in cache |
| `invalidateCache(options?)` | Manually invalidate cache entries |
| `getCacheStatus()` | Returns `'HIT'` or `'MISS'` |
| `successWithCache(result)` | Single-item response with `X-Cache` header (body formatted by the configured `responseEnvelope`) |
| `successPaginatedWithCache(result, info)` | List response with `X-Cache` header and pagination `info` threaded through the `responseEnvelope` |

---

## withCacheInvalidation Mixin

Automatically invalidate caches after mutations:

```typescript
import { withCacheInvalidation } from '@hono-crud/cache';
import { MemoryUpdateEndpoint, MemoryDeleteEndpoint } from '@hono-crud/memory';

class UserUpdate extends withCacheInvalidation(MemoryUpdateEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update user' };
  allowedUpdateFields = ['name', 'role'];

  cacheInvalidation = {
    strategy: 'all',              // Invalidate all user caches
    relatedModels: ['posts'],     // Also invalidate posts cache
  };
}

class UserDelete extends withCacheInvalidation(MemoryDeleteEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Delete user' };

  cacheInvalidation = {
    strategy: 'single',           // Only invalidate the specific record
  };
}
```

### Invalidation Strategies

| Strategy | Description |
|----------|-------------|
| `'all'` | Invalidate all caches for the model (default) |
| `'single'` | Invalidate only the specific record's cache |
| `'list'` | Invalidate only list caches |
| `'pattern'` | Invalidate by custom pattern |
| `'tags'` | Invalidate by cache tags |

### Invalidation Config

| Option | Type | Description |
|--------|------|-------------|
| `strategy` | `InvalidationStrategy` | Invalidation strategy (default: `'all'`) |
| `pattern` | `string` | Custom pattern (for `'pattern'` strategy) |
| `tags` | `string[]` | Tags to invalidate (for `'tags'` strategy) |
| `relatedModels` | `string[]` | Also invalidate these model caches |

---

## ETag Support

Generate and match ETags for conditional requests:

```typescript
import { generateETag, matchesIfNoneMatch, matchesIfMatch } from 'hono-crud';

// Generate ETag from data
const etag = await generateETag(userData);

// Check If-None-Match (GET - 304 Not Modified)
const ifNoneMatch = ctx.req.header('If-None-Match');
if (ifNoneMatch && matchesIfNoneMatch(ifNoneMatch, etag)) {
  return new Response(null, { status: 304 });
}

// Check If-Match (PUT/PATCH - optimistic concurrency)
const ifMatch = ctx.req.header('If-Match');
if (ifMatch && !matchesIfMatch(ifMatch, etag)) {
  return ctx.json({ error: 'Precondition failed' }, 412);
}
```
