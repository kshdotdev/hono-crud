# Rate Limiting

hono-crud provides rate limiting middleware with fixed-window and sliding-window algorithms, tier-based limits, and Memory/Redis storage.

---

## Setup

```typescript
import {
  createRateLimitMiddleware,
  setRateLimitStorage,
  MemoryRateLimitStorage,
} from 'hono-crud';

// Set storage (required before middleware runs)
setRateLimitStorage(new MemoryRateLimitStorage());
```

### Redis Storage

```typescript
import { RedisRateLimitStorage, setRateLimitStorage } from 'hono-crud/rate-limit';

setRateLimitStorage(new RedisRateLimitStorage({
  client: redisClient,
  prefix: 'rl:',
}));
```

### Context-scoped Storage

```typescript
import { createRateLimitStorageMiddleware } from 'hono-crud/storage';

app.use('*', createRateLimitStorageMiddleware(() => {
  return new MemoryRateLimitStorage();
}));
```

---

## Basic Usage

```typescript
// Global: 100 requests per minute per IP
app.use('/api/*', createRateLimitMiddleware({
  limit: 100,
  windowSeconds: 60,
  keyStrategy: 'ip',
  skipPaths: ['/health', '/docs/*'],
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
| `keyStrategy` | `KeyStrategy \| function` | `'ip'` | How to identify clients |
| `keyPrefix` | `string` | `'rl'` | Storage key prefix |
| `skipPaths` | `string[]` | `[]` | Paths to skip (glob patterns) |
| `includeHeaders` | `boolean` | `true` | Include rate limit headers |
| `errorMessage` | `string` | `'Too many requests'` | Error message on 429 |
| `storage` | `RateLimitStorage` | - | Per-middleware storage override |
| `ipHeader` | `string` | - | Custom header for client IP |
| `trustProxy` | `boolean` | - | Trust X-Forwarded-For |
| `apiKeyHeader` | `string` | - | Header for API key strategy |
| `getTier` | `function` | - | Dynamic limits per user |
| `onRateLimitExceeded` | `function` | - | Callback on rate limit hit |

### Key Strategies

| Strategy | Description |
|----------|-------------|
| `'ip'` | Client IP address (default) |
| `'user'` | Authenticated user ID (falls back to IP) |
| `'api-key'` | API key header (falls back to IP) |
| `'combined'` | IP + user ID combination |
| `(ctx) => string` | Custom key extraction function |

---

## Tier-based Limits

Different rate limits based on user type:

```typescript
app.use('/api/*', createRateLimitMiddleware({
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
import { resetRateLimit } from 'hono-crud';

// Reset a specific key (e.g., after successful verification)
await resetRateLimit('rl:/api/login:192.168.1.1');
```

---

## Algorithm Comparison

| Algorithm | Description | Use Case |
|-----------|-------------|----------|
| `fixed-window` | Counts requests in fixed time intervals | Simple, less memory |
| `sliding-window` | Tracks individual request timestamps | Smoother rate limiting, prevents burst at window boundaries |
