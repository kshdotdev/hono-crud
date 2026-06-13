# @hono-crud/cache

Caching mixins and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/cache hono-crud hono
```

## Usage

```ts
import { MemoryCacheStorage } from '@hono-crud/cache';
import { Hono } from 'hono';
import { createStorageMiddleware } from 'hono-crud/storage';

const app = new Hono();

// Inject the storage into context so cache-enabled endpoints / mixins resolve it.
app.use('*', createStorageMiddleware({
  cacheStorage: new MemoryCacheStorage(),
}));
```

Exports cache storage backends (e.g. `MemoryCacheStorage`) and the caching mixins used by hono-crud endpoints.

`cacheConfig.ttlSeconds` is in **seconds**; the `CacheStorage.set` boundary works in **milliseconds** (`ttlMs`). On Cloudflare KV, `expirationTtl` is floored to 60s.
