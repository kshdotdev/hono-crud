---
"hono-crud": patch
---

Restructure the project into a pnpm-workspaces monorepo. `hono-crud` is now the thin core; the database adapters, documentation UIs, and optional middleware ship as separate installable packages under the `@hono-crud/*` scope:

- `@hono-crud/memory`, `@hono-crud/drizzle`, `@hono-crud/prisma` — CRUD adapters (was `hono-crud/adapters/*`)
- `@hono-crud/swagger`, `@hono-crud/scalar` — documentation UIs (was exported from the `hono-crud` barrel / `hono-crud/ui`)
- `@hono-crud/cache`, `@hono-crud/rate-limit`, `@hono-crud/idempotency`, `@hono-crud/health` — optional middleware (was `hono-crud/{cache,rate-limit,idempotency,health}`)

Breaking: these symbols are no longer re-exported from `hono-crud`; install the corresponding `@hono-crud/*` package and import from it. The unified `createCrudMiddleware`, `HonoCrudEnv`, and `StorageEnv` no longer cover cache/rate-limit/idempotency — compose those packages' own middleware instead. A `hono-crud/internal` entrypoint is available for authoring adapters.
