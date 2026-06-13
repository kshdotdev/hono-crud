# Logging

hono-crud provides request/response logging middleware with automatic redaction of sensitive data.

---

## Setup

Inject the storage through `createStorageMiddleware` (or the single-storage
`createLoggingStorageMiddleware` helper) — the recommended path, especially on
edge/serverless runtimes. Both write the `loggingStorage` context var that the
logging middleware resolves from:

<!-- docs-typecheck:prelude -->
```typescript
import { Hono } from 'hono';
import { createStorageMiddleware, createLoggingStorageMiddleware } from 'hono-crud/storage';
import { MemoryLoggingStorage } from 'hono-crud/logging';

const app = new Hono();

app.use('*', createStorageMiddleware({
  loggingStorage: new MemoryLoggingStorage({ maxEntries: 10000 }),
}));

// Single-storage helper (takes a storage instance):
app.use('*', createLoggingStorageMiddleware(new MemoryLoggingStorage()));
```

### Global Storage (long-lived servers)

On a long-lived Node/Bun server you can set a module-global storage once
instead. Resolution priority is context > global, so the setter is a
compatibility option, never a requirement:

```typescript
import { setLoggingStorage } from 'hono-crud/logging';

setLoggingStorage(new MemoryLoggingStorage({ maxEntries: 10000 }));
```

---

## Basic Usage

<!-- docs-typecheck:prelude -->
```typescript
import { createLoggingMiddleware } from 'hono-crud/logging';

app.use('*', createLoggingMiddleware());
```

This logs every request and response with:
- Request ID, method, path, URL, query, headers
- Client IP
- Response status, duration
- Automatic redaction of sensitive headers and body fields

---

## Configuration

```typescript
app.use('*', createLoggingMiddleware({
  // Paths to exclude from logging (replaces the defaults)
  excludePaths: ['/health', '/docs/*', '/openapi.json'],

  // Headers to redact (replaces the defaults)
  redactHeaders: ['authorization', 'cookie', 'x-api-key'],

  // Body fields to redact (replaces the defaults)
  redactBodyFields: ['password', 'token', 'secret', 'creditCard'],

  // Request body logging
  requestBody: {
    enabled: true,
    maxSize: 10000,                     // Max body size to log (bytes)
    contentTypes: ['application/json'], // Content types to log (empty = all)
  },

  // Response body logging
  responseBody: {
    enabled: false,                     // Disabled by default
    maxSize: 10000,
    statusCodes: [400, 500],            // Only log bodies for these statuses (empty = all)
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
| `excludePaths` | `PathPattern[]` | Health/metrics paths (see below) | Paths to skip (exact, glob, or regex) |
| `includePaths` | `PathPattern[]` | `[]` (all paths) | Paths to log; `excludePaths` wins |
| `redactHeaders` | `RedactField[]` | See below | Headers to redact (replaces defaults) |
| `redactBodyFields` | `RedactField[]` | See below | Body fields to redact (replaces defaults) |
| `requestBody` | `RequestBodyConfig` | `{ enabled: false }` | Request body logging config |
| `responseBody` | `ResponseBodyConfig` | `{ enabled: false }` | Response body logging config |
| `level` | `LogLevel` | `'info'` | Default log level |
| `levelResolver` | `function` | - | Derive the level per request (status, duration, error) |
| `generateRequestId` | `function` | UUID generator | Custom request ID function |
| `storage` | `LoggingStorage` | - | Per-middleware storage override |
| `handlers` | `function[]` | - | Extra sinks called per entry (console, APM, ...) |
| `minResponseTimeMs` | `number` | `0` | Skip requests faster than this |

Additional options: `enabled`, `includeHeaders`, `includeQuery`,
`includeClientIp`, `ipHeader`, `trustProxy`, `formatter`, `metadata`,
`onError` — see `LoggingConfig` in `hono-crud/logging`.

### Default Excluded Paths

`/health`, `/healthz`, `/ready`, `/readyz`, `/live`, `/livez`, `/metrics`, `/favicon.ico`

### Default Redacted Headers

`authorization`, `cookie`, `x-api-key`, `x-auth-token`

### Default Redacted Body Fields

`password`, `token`, `secret`, `apiKey`, `api_key`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`, `creditCard`, `credit_card`, `ssn`, `socialSecurityNumber`

---

## Accessing Request Context

```typescript
import { getRequestId, getRequestStartTime } from 'hono-crud/logging';

app.get('/api/data', (c) => {
  const requestId = getRequestId(c);        // string | undefined
  const startTime = getRequestStartTime(c); // number (ms) | undefined

  return c.json({
    requestId,
    processingTime: startTime !== undefined ? Date.now() - startTime : undefined,
  });
});
```

Both return `undefined` when the logging middleware did not run for the
request (e.g. an excluded path).

---

## Custom Storage

Implement the `LoggingStorage` interface for custom backends:

```typescript
import { setLoggingStorage } from 'hono-crud/logging';
import type { LoggingStorage, LogEntry, LogQueryOptions } from 'hono-crud/logging';

// Stand-in for your SQL client
declare function sql(query: string, params?: unknown[]): Promise<{ rows: LogEntry[]; count: number }>;

class PostgresLoggingStorage implements LoggingStorage {
  async store(entry: LogEntry): Promise<void> {
    await sql('INSERT INTO logs (id, entry) VALUES ($1, $2)', [entry.id, JSON.stringify(entry)]);
  }

  async query(options?: LogQueryOptions): Promise<LogEntry[]> {
    const { rows } = await sql('SELECT entry FROM logs ORDER BY timestamp DESC LIMIT $1', [
      options?.limit ?? 100,
    ]);
    return rows;
  }

  async getById(id: string): Promise<LogEntry | null> {
    const { rows } = await sql('SELECT entry FROM logs WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async count(options?: LogQueryOptions): Promise<number> {
    const { count } = await sql('SELECT count(*) FROM logs WHERE level = $1', [options?.level]);
    return count;
  }

  async deleteOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const { count } = await sql('DELETE FROM logs WHERE timestamp < $1', [cutoff]);
    return count;
  }

  async clear(): Promise<number> {
    const { count } = await sql('DELETE FROM logs');
    return count;
  }
}

setLoggingStorage(new PostgresLoggingStorage());
```

---

## Redaction

### How Redaction Works

Sensitive values are replaced with `'[REDACTED]'` in logged output. Redaction applies to:

- **Headers**: Matched case-insensitively against `redactHeaders`
- **Body fields**: Matched by key name against `redactBodyFields` (recursively, including nested objects)

### Using Redaction Utilities Directly

```typescript
import { redactHeaders, redactObject, shouldRedact } from 'hono-crud/logging';

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
import type { LogLevel } from 'hono-crud/logging';

interface LogEntry {
  id: string;            // Request ID
  timestamp: string;     // ISO 8601
  level: LogLevel;
  request: {
    method: string;
    path: string;
    url: string;                      // full URL including query string
    headers?: Record<string, string>; // may be redacted
    query?: Record<string, string>;
    body?: unknown;                   // may be redacted or truncated
    clientIp?: string;
    userId?: string;                  // if available
  };
  response: {
    statusCode: number;
    headers?: Record<string, string>;
    body?: unknown;
    responseTimeMs: number;           // milliseconds
  };
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}
```
