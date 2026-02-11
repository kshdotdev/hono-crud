# Logging

hono-crud provides request/response logging middleware with automatic redaction of sensitive data.

---

## Setup

```typescript
import {
  createLoggingMiddleware,
  setLoggingStorage,
  MemoryLoggingStorage,
} from 'hono-crud';

// Set storage (required before middleware runs)
setLoggingStorage(new MemoryLoggingStorage({ maxEntries: 10000 }));
```

### Context-scoped Storage

```typescript
import { createLoggingStorageMiddleware } from 'hono-crud/storage';

app.use('*', createLoggingStorageMiddleware(() => {
  return new MemoryLoggingStorage();
}));
```

---

## Basic Usage

```typescript
app.use('*', createLoggingMiddleware());
```

This logs every request and response with:
- Request ID, method, path, query, headers
- Client IP, user agent
- Response status, duration
- Automatic redaction of sensitive headers and body fields

---

## Configuration

```typescript
app.use('*', createLoggingMiddleware({
  // Paths to exclude from logging
  excludePaths: ['/health', '/docs/*', '/openapi.json'],

  // Headers to redact (added to defaults)
  redactHeaders: ['authorization', 'cookie', 'x-api-key'],

  // Body fields to redact (added to defaults)
  redactBodyFields: ['password', 'token', 'secret', 'creditCard'],

  // Request body logging
  requestBody: {
    enabled: true,
    maxSize: 10000,                    // Max body size to log (bytes)
    allowedContentTypes: ['application/json'],
  },

  // Response body logging
  responseBody: {
    enabled: false,                     // Disabled by default
    maxSize: 10000,
    allowedContentTypes: ['application/json'],
  },

  // Log level
  level: 'info',                        // 'debug' | 'info' | 'warn' | 'error'

  // Custom request ID generation
  generateRequestId: () => crypto.randomUUID(),
}));
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `excludePaths` | `string[]` | `[]` | Paths to skip (glob patterns) |
| `redactHeaders` | `string[]` | See below | Headers to redact |
| `redactBodyFields` | `string[]` | See below | Body fields to redact |
| `requestBody` | `object` | `{ enabled: true }` | Request body logging config |
| `responseBody` | `object` | `{ enabled: false }` | Response body logging config |
| `level` | `LogLevel` | `'info'` | Minimum log level |
| `generateRequestId` | `function` | UUID generator | Custom request ID function |

### Default Redacted Headers

`authorization`, `cookie`, `x-api-key`, `x-auth-token`

### Default Redacted Body Fields

`password`, `token`, `secret`, `apiKey`, `api_key`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`

---

## Accessing Request Context

```typescript
import { getRequestId, getRequestStartTime } from 'hono-crud';

app.get('/api/data', (c) => {
  const requestId = getRequestId(c);       // string
  const startTime = getRequestStartTime(c); // number (ms)

  return c.json({
    requestId,
    processingTime: Date.now() - startTime,
  });
});
```

---

## Custom Storage

Implement the `LoggingStorage` interface for custom backends:

```typescript
import type { LoggingStorage, LogEntry, LogQueryOptions } from 'hono-crud';

class PostgresLoggingStorage implements LoggingStorage {
  async store(entry: LogEntry): Promise<void> {
    await db.insert(logs).values(entry);
  }

  async query(options: LogQueryOptions): Promise<LogEntry[]> {
    // Implement query logic
    return [];
  }

  async count(options: LogQueryOptions): Promise<number> {
    // Implement count logic
    return 0;
  }

  async clear(): Promise<void> {
    await db.delete(logs);
  }
}

setLoggingStorage(new PostgresLoggingStorage());
```

---

## Redaction

### How Redaction Works

Sensitive values are replaced with `'[REDACTED]'` in logged output. Redaction applies to:

- **Headers**: Matched case-insensitively against `redactHeaders`
- **Body fields**: Matched by key name against `redactBodyFields`

### Using Redaction Utilities Directly

```typescript
import { redactHeaders, redactObject, shouldRedact } from 'hono-crud';

// Redact specific headers
const safeHeaders = redactHeaders(
  { authorization: 'Bearer xxx', 'content-type': 'application/json' },
  ['authorization']
);
// { authorization: '[REDACTED]', 'content-type': 'application/json' }

// Redact object fields
const safeBody = redactObject(
  { email: 'test@example.com', password: 'secret123' },
  ['password']
);
// { email: 'test@example.com', password: '[REDACTED]' }
```

---

## Log Entry Structure

Each log entry contains:

```typescript
interface LogEntry {
  id: string;           // Request ID
  timestamp: string;    // ISO 8601
  level: LogLevel;
  request: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body?: unknown;
    ip: string;
    userAgent: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
    duration: number;   // milliseconds
  };
  userId?: string;
  error?: string;
}
```
