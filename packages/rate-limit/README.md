# @hono-crud/rate-limit

Rate limiting middleware and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/rate-limit hono-crud hono
```

## Usage

```ts
import { createStorageMiddleware } from 'hono-crud/storage';
import {
  createRateLimitMiddleware,
  MemoryRateLimitStorage,
  type RateLimitEnv,
} from '@hono-crud/rate-limit';

// Wire storage (recommended: per-request injection, edge-safe)
app.use('*', createStorageMiddleware({
  rateLimitStorage: new MemoryRateLimitStorage(),
}));

app.use('/api/*', createRateLimitMiddleware<RateLimitEnv>({
  limit: 100,
  windowSeconds: 60,
}));
```

On a long-lived server, `setRateLimitStorage(new MemoryRateLimitStorage())` once at boot is the module-global alternative (resolution priority: explicit `config.storage` > context > global).

Exports `createRateLimitMiddleware`, the storage quartet (`setRateLimitStorage` / `getRateLimitStorage` / `getRateLimitStorageRequired` / `resolveRateLimitStorage`), `MemoryRateLimitStorage` / `RedisRateLimitStorage` / `KVRateLimitStorage`, `RateLimitExceededException`, and the `RateLimitEnv` type.
