# Caching

hono-crud provides response caching via mixins (`withCache`, `withCacheInvalidation`) and supports Memory and Redis storage backends.

---

## Setup

```typescript
import { setCacheStorage, MemoryCacheStorage } from 'hono-crud';

// Use in-memory cache (default if not set)
setCacheStorage(new MemoryCacheStorage());
```

### Redis Storage

```typescript
import { RedisCacheStorage, setCacheStorage } from 'hono-crud/cache';

setCacheStorage(new RedisCacheStorage({
  client: redisClient,     // Any Redis client with get/set/del/keys
  prefix: 'cache:',        // Key prefix (default: 'cache:')
}));
```

### Context-scoped Storage

For multi-tenant or per-request storage:

```typescript
import { createCacheStorageMiddleware } from 'hono-crud/storage';

app.use('*', createCacheStorageMiddleware(() => {
  return new MemoryCacheStorage();
}));
```

---

## withCache Mixin

Add caching to read/list endpoints:

```typescript
import { withCache } from 'hono-crud';
import { MemoryReadEndpoint, MemoryListEndpoint } from 'hono-crud/adapters/memory';

class UserRead extends withCache(MemoryReadEndpoint) {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get user' };

  cacheConfig = {
    ttl: 300,           // 5 minutes
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
| `ttl` | `number` | `300` | Time to live in seconds |
| `perUser` | `boolean` | `false` | Include userId in cache key |
| `tags` | `string[]` | `[]` | Cache tags for targeted invalidation |
| `keyFields` | `string[]` | - | Additional fields in cache key |
| `prefix` | `string` | - | Custom key prefix |

### Cache Methods

| Method | Description |
|--------|-------------|
| `getCachedResponse<T>()` | Get cached data (returns `null` on miss) |
| `setCachedResponse<T>(data)` | Store data in cache |
| `invalidateCache(options?)` | Manually invalidate cache entries |
| `getCacheStatus()` | Returns `'HIT'` or `'MISS'` |
| `successWithCache(result)` | Response with `X-Cache` header |

---

## withCacheInvalidation Mixin

Automatically invalidate caches after mutations:

```typescript
import { withCacheInvalidation } from 'hono-crud';

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
