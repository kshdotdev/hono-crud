# @hono-crud/rate-limit

Rate limiting middleware and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/rate-limit hono-crud hono
```

## Usage

```ts
import {
  createRateLimitMiddleware,
  setRateLimitStorage,
  MemoryRateLimitStorage,
  type RateLimitEnv,
} from '@hono-crud/rate-limit';

setRateLimitStorage(new MemoryRateLimitStorage());

app.use('/api/*', createRateLimitMiddleware<RateLimitEnv>({
  limit: 100,
  windowMs: 60_000,
}));
```

Exports `createRateLimitMiddleware`, `setRateLimitStorage`, `MemoryRateLimitStorage`, `RateLimitExceededException`, and the `RateLimitEnv` type.
