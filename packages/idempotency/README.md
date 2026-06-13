# @hono-crud/idempotency

Idempotency middleware and storage backends for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/idempotency hono-crud hono
```

## Usage

```ts
import {
  createIdempotencyMiddleware,
  MemoryIdempotencyStorage,
} from '@hono-crud/idempotency';
import { Hono } from 'hono';
import { createStorageMiddleware } from 'hono-crud/storage';

const app = new Hono();

// Wire storage (recommended: per-request injection, edge-safe)
app.use('*', createStorageMiddleware({
  idempotencyStorage: new MemoryIdempotencyStorage(),
}));

// Replays the original response for repeated requests carrying the same Idempotency-Key.
app.use('/api/*', createIdempotencyMiddleware());
```

On a long-lived server, `setIdempotencyStorage(new MemoryIdempotencyStorage())` once at boot is the module-global alternative (resolution priority: explicit `config.storage` > context > global).

## Production storage

`MemoryIdempotencyStorage` is per-process / per-isolate: on Cloudflare Workers (or any multi-instance deployment) a retry may hit a different isolate with an empty store, so replay protection is not guaranteed exactly where it matters. Use `RedisIdempotencyStorage` in production — compatible with `@upstash/redis` (edge-safe) out of the box:

<!-- docs-typecheck:skip external SDK (@upstash/redis) not installed in this repo -->
```ts
import { Redis } from '@upstash/redis';
import { RedisIdempotencyStorage } from '@hono-crud/idempotency';
import { createStorageMiddleware } from 'hono-crud/storage';

app.use('*', async (c, next) => {
  const idempotencyStorage = new RedisIdempotencyStorage({
    client: new Redis({ url: c.env.REDIS_URL, token: c.env.REDIS_TOKEN }),
  });
  return createStorageMiddleware({ idempotencyStorage })(c, next);
});
```

### Why there is no Cloudflare KV backend

The in-flight lock that prevents two concurrent requests with the same key from both executing must be **atomic** (compare-and-set). Redis expresses it as a single `SET key value NX PX ttl` round-trip. Cloudflare KV has no compare-and-swap, so a KV "lock" would be a read-then-write race — advisory only. For the one feature whose failure mode is duplicate side effects (double charges), an advisory lock is a correctness footgun, so the KV backend is deliberately omitted. Cloudflare-native users should use Upstash Redis today; Durable Objects (not KV) is the correct Cloudflare primitive for a possible future first-party backend.

## Errors

The middleware throws `ApiException` subclasses that flow through `createErrorHandler` (ErrorMappers / ErrorHooks / custom `responseEnvelope`) like every sibling middleware:

- `IdempotencyKeyRequiredException` — 400 `IDEMPOTENCY_KEY_REQUIRED` (header missing under `required: true`)
- `IdempotencyConflictException` — 409 `IDEMPOTENCY_CONFLICT` (same key already in flight)

Exports `createIdempotencyMiddleware`, the storage quartet (`setIdempotencyStorage` / `getIdempotencyStorage` / `getIdempotencyStorageRequired` / `resolveIdempotencyStorage`), `MemoryIdempotencyStorage`, `RedisIdempotencyStorage`, and the exception classes.
