# Cloudflare Workers, D1, KV and R2

hono-crud is written for edge runtimes (Web Crypto only, no Node built-ins,
`waitUntil`-aware background work), and its Drizzle adapter is driver
agnostic, so a Worker with a D1 database is a first-class deployment target.
This guide collects what is specific to that platform: wiring bindings per
request, the KV-backed storages, durable audit/version history on D1, and
the D1 limits you must design around.

## Bindings

A `wrangler.toml` for an API with a database, a response cache, a rate
limiter and a file bucket:

```toml
name = "my-api"
main = "src/index.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "my-api"
database_id = "<id from `wrangler d1 create`>"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "CACHE_KV"
id = "<id from `wrangler kv namespace create CACHE_KV`>"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<id>"

[[r2_buckets]]
binding = "FILES"
bucket_name = "my-api-files"

[vars]
WEB_ORIGIN = "http://localhost:3000"
```

Secrets (`wrangler secret put JWT_SECRET`) never go in the file; locally they
live in a git-ignored `.dev.vars`. Binding ids are identifiers, not
credentials.

## Everything is per request

Bindings exist only on `c.env`, so nothing that touches a binding may be a
module-level singleton. Build the app with `new OpenAPIHono<Env>()` (a plain
`Hono` cannot be adopted by `fromHono`, and it now throws if it already
carries middleware) and inject the database and the storages in middleware:

<!-- docs-typecheck:prelude -->
```ts
import { KVCacheStorage } from '@hono-crud/cache';
import { DrizzleAuditLogStorage, createDrizzleCrud, sqliteAuditLogTable } from '@hono-crud/drizzle';
import type { DrizzleDatabaseConstraint } from '@hono-crud/drizzle';
import { KVRateLimitStorage } from '@hono-crud/rate-limit';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import type { AuthEnv } from 'hono-crud/auth';
import type { KVNamespace } from 'hono-crud/cloudflare';
import { type StorageEnv, createStorageMiddleware } from 'hono-crud/storage';
import { z } from 'zod';

// Minimal binding shapes so this guide typechecks without @cloudflare/workers-types.
type D1Database = Parameters<typeof drizzle>[0];
interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

type Bindings = {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  FILES: R2Bucket;
  WEB_ORIGIN: string;
  JWT_SECRET: string;
};
type Env = StorageEnv & AuthEnv & { Bindings: Bindings };

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const auditLog = sqliteAuditLogTable('audit_log');

const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  done: z.boolean().default(false),
  deletedAt: z.number().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const taskMeta = defineMeta({
  model: defineModel({
    tableName: 'tasks',
    schema: TaskSchema,
    primaryKeys: ['id'],
    table: tasks,
    softDelete: { field: 'deletedAt' },
    timestamps: true,
    audit: { tableName: 'audit_log' },
  }),
  fields: z.object({ title: z.string().min(1), done: z.boolean().optional() }),
});

// No database here: the endpoints read `c.var.db`, injected below.
const Tasks = createDrizzleCrud<typeof taskMeta, Env>(
  undefined as unknown as DrizzleDatabaseConstraint,
  taskMeta,
  { dialect: 'sqlite' },
);

const base = new OpenAPIHono<Env>();

base.use('*', async (c, next) => {
  const db = drizzle(c.env.DB);
  c.set('db' as never, db as never); // CONTEXT_KEYS.db — resolved by every Drizzle endpoint
  return createStorageMiddleware<Env>({
    cacheStorage: new KVCacheStorage({ kv: c.env.CACHE_KV }),
    rateLimitStorage: new KVRateLimitStorage({ kv: c.env.RATE_LIMIT_KV }),
    auditStorage: new DrizzleAuditLogStorage({ db, table: auditLog }),
  })(c, next);
});

export const app = fromHono(base);

export const routes = registerCrud(app, '/tasks', {
  create: Tasks.Create,
  list: Tasks.List,
  read: Tasks.Read,
  update: Tasks.Update,
  delete: Tasks.Delete,
  restore: Tasks.Restore,
});

export default { fetch: app.fetch };
```

`createStorageMiddleware` writes each storage onto the request context;
cached list/read endpoints, the rate limiter and audited models pick them
up from there. The same pattern applies to `DrizzleVersioningStorage` +
`sqliteVersionHistoryTable()` for record history.

## Column conventions that keep D1 happy

D1's `bind()` accepts only `null | number | string | ArrayBuffer | boolean`,
so what a column declares decides what the engine may write. hono-crud reads
the Drizzle column's `dataType` and adapts:

| Column | Managed timestamps / soft delete write | Filter values |
|---|---|---|
| `integer('created_at')` (plain) | epoch milliseconds | `?createdAt[gte]=1700000000000` → number |
| `integer('due', { mode: 'timestamp' \| 'timestamp_ms' })` | a `Date` (Drizzle stores seconds / ms) | `?due[gte]=2026-01-01` → `Date` (declare `z.date()` / `z.coerce.date()`) |
| `text('deleted_at')` | ISO-8601 string | string |
| `integer('done', { mode: 'boolean' })` | — | `?done=false` → `false` (declare `z.boolean()`) |
| `text('secret', { mode: 'json' })` | — | required for `fieldEncryption` and any object-valued field |

Filter values are coerced from the query string by the model's zod kind, so
`z.number()` / `z.boolean()` / `z.date()` fields receive typed values and
garbage is a 400 rather than a wrong match.

Generate ids in the application (`Model.id` defaults to `crypto.randomUUID()`,
available on Workers); D1 has no `gen_random_uuid()`.

## D1 limits to design around

- **No interactive transactions.** `drizzle-orm/d1` implements
  `transaction()` with `BEGIN`/`COMMIT` statements that D1 rejects. Leave
  `useTransaction` at its default (`false`) on Create/Update/Delete/Restore;
  the batch verbs already run bare statements. For multi-statement atomic
  writes in your own endpoints, use `db.batch([...])` with client-generated
  ids — it is atomic but not interactive (no read-then-write inside).
- **~100 bound parameters per statement.** Keep batch payloads and
  `?include=` page sizes small (`maxPerPage` around 50 with includes), and
  chunk your own `inArray` calls.
- **Response size** is capped (5 MB / 100k rows per query). Do not register
  `aggregate` or buffered `export` on large tables; prefer `?stream=true`
  CSV export.
- **Objects cannot be bound.** See the column table above; an encrypted or
  JSON-valued field needs a `text({ mode: 'json' })` column.

## KV caveats

- TTLs are floored to **60 seconds** by the platform; `KVCacheStorage` keeps
  an application-level `expiresAt` so shorter TTLs still behave.
- KV is eventually consistent (about 60 s) and allows one write per second
  per key: `KVRateLimitStorage` is best effort and fails open by default —
  put a Cloudflare WAF rate-limiting rule in front of anything that must be
  strict, or use Durable Objects.
- Tag-based invalidation (`cacheInvalidate: { strategy: 'tags', tags: [...] }`)
  is cheaper than the default pattern scan, which is a `list()` walk on KV.
- **There is no KV idempotency backend by design**: KV has no compare-and-set,
  so the in-flight lock would be advisory only. Use the Durable Object or
  Redis storage from `@hono-crud/idempotency`.

## Background work

The runtime cancels pending promises when the response returns unless they
are handed to `executionCtx.waitUntil`. Endpoints get `this.runAfterResponse`;
middleware and services use the same helper from the `cloudflare` subpath:

```ts
import { createAfterResponse } from 'hono-crud/cloudflare';

app.use('*', async (c, next) => {
  const afterResponse = createAfterResponse(c);
  await next();
  afterResponse(c.env.FILES.delete('tmp/upload.bin'));
});
```

## Health checks with bindings

Checks receive the request context, so a readiness probe can reach the
bindings:

```ts
import { sql } from 'drizzle-orm';
import { createHealthRoutes } from 'hono-crud/health';

app.route(
  '/',
  createHealthRoutes<Env>({
    version: '1.0.0',
    checks: [
      {
        name: 'd1',
        check: async (c) => {
          await drizzle(c.env.DB).run(sql`select 1`);
        },
      },
    ],
  }),
);
```

## Sessions from an external auth library

Map the session your auth library resolves (Better Auth, Lucia, …) onto the
auth context once, and every guard, audit `userId` and policy works:

```ts
import { requireRoles, setAuthContext } from 'hono-crud/auth';
import { UnauthorizedException } from 'hono-crud';

// Your auth library's session lookup (Better Auth: `auth.api.getSession({ headers })`).
declare function resolveSession(headers: Headers): Promise<{ userId: string; role: string } | null>;

app.use('/api/*', async (c, next) => {
  const session = await resolveSession(c.req.raw.headers); // your auth library
  if (!session) throw new UnauthorizedException('Not authenticated');
  setAuthContext(c, { id: session.userId, roles: [session.role] }, 'session');
  await next();
});

registerCrud(app, '/api/admin/tasks', { list: Tasks.List }, { middlewares: [requireRoles('admin')] });
```

## Testing

`@cloudflare/vitest-pool-workers` runs the suite inside miniflare with real
D1/KV/R2 bindings — see this repository's `vitest.config.workers.ts` and
`tests/workers/`. Apply your migrations in a setup file with
`applyD1Migrations` from `cloudflare:test`, then drive the app through
`app.fetch(request, env)` or the typed client (`hc<typeof routes>('http://x', { fetch: (req, init) => app.fetch(new Request(req, init), env) })`).

## See also

- [Typed RPC client](./typed-client.md) — `hc<typeof routes>` for your frontends.
- [Caching](./caching.md), [Rate limiting](./rate-limiting.md), [Database adapters](./database-adapters.md).
