# Rate Limiting

Rate limiting lives in the `@hono-crud/rate-limit` package. It provides middleware with fixed-window and sliding-window algorithms, tier-based limits, and Memory/Redis/Cloudflare KV storage.

Install: `npm install @hono-crud/rate-limit`.

---

## Setup

Inject the storage through `createStorageMiddleware` — the recommended path,
especially on edge/serverless runtimes where backends are built from
per-request bindings. It writes the `rateLimitStorage` context var that the
rate-limit middleware resolves from:

<!-- docs-typecheck:prelude -->
```typescript
import { Hono } from 'hono';
import { createStorageMiddleware } from 'hono-crud/storage';
import { createRateLimitMiddleware, MemoryRateLimitStorage } from '@hono-crud/rate-limit';

const app = new Hono();

app.use('*', createStorageMiddleware({
  rateLimitStorage: new MemoryRateLimitStorage(),
}));
```

### Redis Storage

```typescript
import { RedisRateLimitStorage } from '@hono-crud/rate-limit';
import type { RedisRateLimitClient } from '@hono-crud/rate-limit';

declare const redisClient: RedisRateLimitClient; // your ioredis / node-redis client

app.use('*', createStorageMiddleware({
  rateLimitStorage: new RedisRateLimitStorage({ client: redisClient }),
}));
```

The optional `prefix` adds extra namespacing on top of the keys the middleware
produces; it defaults to `''` because keys are already namespaced by the
middleware's `keyPrefix` (default `'rl'`).

### Global Storage (long-lived servers)

On a long-lived Node/Bun server you can set a module-global storage once
instead. Resolution priority is explicit `config.storage` > context > global,
so the setter is a compatibility option, never a requirement:

```typescript
import { setRateLimitStorage } from '@hono-crud/rate-limit';

setRateLimitStorage(new MemoryRateLimitStorage());
```

---

## Basic Usage

```typescript
// Global: 100 requests per minute per IP
app.use('/api/*', createRateLimitMiddleware({
  limit: 100,
  windowSeconds: 60,
  keyStrategy: 'ip',
  excludePaths: ['/health', '/docs/*'],
}));

// Stricter limit for expensive operations
app.use('/api/export/*', createRateLimitMiddleware({
  limit: 5,
  windowSeconds: 60,
  keyPrefix: 'rl:export',
}));
```

### Response Headers

When `includeHeaders: true` (default), responses include:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706140800
```

When rate limit is exceeded, the response is `429 Too Many Requests` with a `Retry-After` header.

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | `number` | `100` | Maximum requests per window |
| `windowSeconds` | `number` | `60` | Window size in seconds |
| `algorithm` | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Rate limit algorithm |
| `keyStrategy` | `KeyStrategy \| KeyExtractor` | `'ip'` | How to identify clients |
| `keyPrefix` | `string` | `'rl'` | Storage key prefix |
| `excludePaths` | `PathPattern[]` | `[]` | Paths excluded from rate limiting (exact, glob, or regex) |
| `includeHeaders` | `boolean` | `true` | Include rate limit headers |
| `errorMessage` | `string` | `'Too many requests'` | Error message on 429 |
| `storage` | `RateLimitStorage` | - | Per-middleware storage override |
| `ipHeader` | `string` | `'X-Forwarded-For'` | Custom header for client IP |
| `trustProxy` | `boolean` | `true` | Trust proxy headers for IP extraction |
| `apiKeyHeader` | `string` | `'X-API-Key'` | Header for API key strategy |
| `getTier` | `TierFunction` | - | Dynamic limits per user |
| `onRateLimitExceeded` | `OnRateLimitExceeded` | - | Callback on rate limit hit |

### Key Strategies

| Strategy | Description |
|----------|-------------|
| `'ip'` | Client IP address (default) |
| `'user'` | Authenticated user ID (falls back to IP) |
| `'api-key'` | API key header (falls back to IP) |
| `'combined'` | IP + user ID combination |
| `(ctx) => string \| undefined` | Custom key extraction function (`undefined` skips rate limiting) |

---

## Tier-based Limits

Different rate limits based on user type. The `'user'` strategy and
`ctx.get('user')` read the auth context, so type the middleware with `AuthEnv`
from `hono-crud/auth`:

```typescript
import type { AuthEnv } from 'hono-crud/auth';

app.use('/api/*', createRateLimitMiddleware<AuthEnv>({
  keyStrategy: 'user',
  getTier: async (ctx) => {
    const user = ctx.get('user');

    if (user?.roles?.includes('premium')) {
      return { limit: 1000, windowSeconds: 60 };
    }

    if (user?.roles?.includes('user')) {
      return { limit: 200, windowSeconds: 60 };
    }

    // Anonymous / guest
    return { limit: 50, windowSeconds: 60 };
  },
}));
```

---

## Custom Key Strategy

```typescript
import { extractIP } from '@hono-crud/rate-limit';

app.use('/api/*', createRateLimitMiddleware({
  keyStrategy: (ctx) => {
    // Rate limit by organization
    const orgId = ctx.req.header('X-Org-ID');
    return orgId ? `org:${orgId}` : extractIP(ctx);
  },
  limit: 500,
  windowSeconds: 60,
}));
```

---

## Rate Limit Exceeded Callback

```typescript
app.use('/api/*', createRateLimitMiddleware({
  limit: 100,
  windowSeconds: 60,
  onRateLimitExceeded: async (ctx, result, key) => {
    console.warn(`Rate limit exceeded for ${key}`, {
      limit: result.limit,
      remaining: result.remaining,
      retryAfter: result.retryAfter,
    });
  },
}));
```

---

## Reset Rate Limit

```typescript
import { resetRateLimit } from '@hono-crud/rate-limit';

// Reset a specific key (e.g., after successful verification)
await resetRateLimit('rl:/api/login:192.168.1.1');
```

---

## Algorithm Comparison

| Algorithm | Description | Use Case |
|-----------|-------------|----------|
| `fixed-window` | Counts requests in fixed time intervals | Simple, less memory |
| `sliding-window` | Tracks individual request timestamps | Smoother rate limiting, prevents burst at window boundaries |
