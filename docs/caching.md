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

<!-- docs-typecheck:prelude -->
```typescript
import { MemoryCacheStorage } from '@hono-crud/cache';
import { Hono } from 'hono';
import { createStorageMiddleware } from 'hono-crud/storage';

const app = new Hono();

app.use('*', createStorageMiddleware({
  cacheStorage: new MemoryCacheStorage(),
}));
```

### Redis Storage

```typescript
import { RedisCacheStorage, type RedisClient } from '@hono-crud/cache';

declare const redisClient: RedisClient; // any client with get/set/del (+ optional keys/scan)

app.use('*', createStorageMiddleware({
  cacheStorage: new RedisCacheStorage({
    client: redisClient,
    prefix: 'cache:',      // Key prefix (default: 'cache:')
  }),
}));
```

### Global Storage (long-lived servers)

On a long-lived Node/Bun server you can set a module-global storage once
instead. Resolution priority is context > global, so the setter is a
compatibility option, never a requirement:

```typescript
import { setCacheStorage } from '@hono-crud/cache';

setCacheStorage(new MemoryCacheStorage());
```

---

## withCache Mixin

The endpoint samples below share this model:

<!-- docs-typecheck:prelude -->
```typescript
import { defineMeta, defineModel } from 'hono-crud';
import { z } from 'zod';

const UserSchema = z.object({ id: z.uuid(), name: z.string(), role: z.string() });
const UserModel = defineModel({ tableName: 'users', schema: UserSchema, primaryKeys: ['id'] });
const userMeta = defineMeta({ model: UserModel });
```

Add caching to read/list endpoints. The route registrar calls
`setContext(c)` before invoking `handle()`, so the override is
parameterless — no manual context wiring:

```typescript
import { withCache } from '@hono-crud/cache';
import { MemoryReadEndpoint } from '@hono-crud/memory';

class UserRead extends withCache(MemoryReadEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get user' };

  cacheConfig = {
    ttlSeconds: 300,    // 5 minutes
    perUser: false,     // Shared cache (true = per-user cache keys)
    tags: ['users'],    // Cache tags for targeted invalidation
  };

  override async handle(): Promise<Response> {
    // Try cache first
    const cached = await this.getCachedResponse();
    if (cached) {
      return this.successWithCache(cached);
    }

    // Fetch from database
    const response = await super.handle();

    // Cache successful responses
    if (response.status === 200) {
      const data = (await response.clone().json()) as { result: unknown };
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
import { withCacheInvalidation, type CacheInvalidationConfig } from '@hono-crud/cache';
import { MemoryDeleteEndpoint, MemoryUpdateEndpoint } from '@hono-crud/memory';

class UserUpdate extends withCacheInvalidation(MemoryUpdateEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update user' };
  allowedUpdateFields = ['name', 'role'];

  cacheInvalidation: CacheInvalidationConfig = {
    strategy: 'all',              // Invalidate all user caches
    relatedModels: ['posts'],     // Also invalidate posts cache
  };
}

class UserDelete extends withCacheInvalidation(MemoryDeleteEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Delete user' };

  cacheInvalidation: CacheInvalidationConfig = {
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
import { generateETag, matchesIfMatch, matchesIfNoneMatch } from 'hono-crud';

app.get('/users/:id', async (c) => {
  const userData = { id: c.req.param('id'), name: 'Ada' }; // your lookup

  // Generate ETag from data
  const etag = await generateETag(userData);

  // Check If-None-Match (GET - 304 Not Modified)
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304 });
  }

  return c.json(userData, 200, { ETag: etag });
});

app.put('/users/:id', async (c) => {
  const current = { id: c.req.param('id'), name: 'Ada' }; // current record
  const etag = await generateETag(current);

  // Check If-Match (PUT/PATCH - optimistic concurrency)
  const ifMatch = c.req.header('If-Match');
  if (ifMatch && !matchesIfMatch(ifMatch, etag)) {
    return c.json({ error: 'Precondition failed' }, 412);
  }

  // ...apply the update
  return c.json(current);
});
```
