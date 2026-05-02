# hono-crud Examples

The examples are both documentation and regression coverage. They compile under
`tsconfig.examples.json`, and the comprehensive Memory, Drizzle/Postgres,
Prisma/Postgres, and Drizzle D1 examples are imported directly by Vitest so
tests exercise the same apps shown here.

## Prerequisites

Memory examples require no external services. Database-backed examples use the
Postgres service in `examples/docker-compose.yml`.

```bash
pnpm install
pnpm run db:up
pnpm run prisma:generate
pnpm run prisma:push
```

Default Postgres settings:

| Setting | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5432` |
| User | `postgres` |
| Password | `postgres` |
| Database | `hono_crud` |

Override them with `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, or
`DATABASE_URL`.

## Verification

```bash
pnpm run typecheck
pnpm run typecheck:examples
pnpm run test:unit
pnpm run test:package-example
pnpm run test:examples
pnpm run test:workers
pnpm test
```

`pnpm test` runs the full suite and expects Postgres to be reachable. The
Workers/D1 examples run through `vitest.config.workers.ts`.

The old `scripts/test-api.ts` entrypoint now delegates to `pnpm run
test:examples`; it no longer writes JSON response snapshots.

## Running Demos

```bash
pnpm run dev:memory
pnpm run dev:drizzle
pnpm run dev:prisma
```

Most examples expose OpenAPI JSON at `/openapi.json`, Swagger UI at `/docs`, and
a health check at `/health`.

## Local File Install Simulation

`examples/local-consumer` is the consumer-style example. It installs this
library as `"hono-crud": "file:../.."`, imports from `hono-crud` and
`hono-crud/adapters/memory`, and runs a real Hono HTTP server. This is the
closest local simulation of installing the package from npm.

Spin up the API from the repo root:

```bash
pnpm run example:local:dev
```

Then hit it:

```bash
curl http://localhost:3456/health
curl -X POST http://localhost:3456/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'
curl "http://localhost:3456/users?role=admin"
```

Run the automated installed-package feature test. It builds the package,
installs it through `file:../..`, starts the Hono API, and drives the routes
over HTTP:

```bash
pnpm run example:local:test
```

## Public API Matrix

| Feature family | Examples | Runtime coverage |
| --- | --- | --- |
| Basic CRUD, read, update, delete, list | `memory/basic-crud.ts`, `drizzle/basic-crud.ts`, `prisma/basic-crud.ts`, all `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres |
| Filtering, sorting, pagination, search | `memory/comprehensive.ts`, `drizzle/filtering.ts`, `prisma/filtering.ts`, adapter `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres, D1 filtering/search |
| Soft delete and restore | `memory/soft-delete.ts`, `drizzle/soft-delete.ts`, `prisma/soft-delete.ts`, adapter `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres |
| Batch create, update, delete, restore | `memory/batch-operations.ts`, `drizzle/batch-operations.ts`, `prisma/batch-operations.ts`, adapter `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres |
| Upsert and batch upsert | `memory/upsert.ts`, `memory/batch-upsert.ts`, `drizzle/upsert.ts`, `prisma/upsert.ts`, adapter `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres |
| Bulk patch and clone | `local-consumer`, public endpoint classes in `src/endpoints/bulk-patch.ts` and `src/endpoints/clone.ts` | Installed-package HTTP coverage plus unit coverage |
| Relations and includes | `memory/relations.ts`, `drizzle/relations.ts`, `prisma/relations.ts`, adapter `comprehensive.ts` files | Memory, Drizzle/Postgres, Prisma/Postgres |
| Cascade delete and nested writes | `memory/cascade-delete.ts`, `memory/nested-writes.ts` | Typechecked examples plus unit coverage |
| Field selection and computed fields | `memory/field-selection.ts`, `memory/computed-fields.ts` | Typechecked examples plus unit coverage |
| Aggregate, import, export | `local-consumer`, public endpoint classes in `src/endpoints/aggregate.ts`, `src/endpoints/import.ts`, `src/endpoints/export.ts` | Installed-package HTTP coverage plus unit coverage |
| Auth and guards | `local-consumer`, public auth helpers from `src/auth` | Installed-package HTTP coverage plus unit coverage |
| Cache and invalidation | `local-consumer`, public cache helpers from `src/cache` plus D1 KV cache wiring in `drizzle/d1-crud.ts` | Installed-package HTTP coverage, unit coverage, and Workers KV coverage |
| Logging and storage middleware | Public logging and storage helpers from `src/logging` and `src/storage` | Unit and Workers storage middleware coverage |
| Idempotency and health | `local-consumer`, public helpers from `src/idempotency` and `src/health`; health routes in adapter `comprehensive.ts` files | Installed-package HTTP coverage, unit coverage, and runtime health checks |
| Audit logging and versioning | `local-consumer`, `memory/audit-logging.ts`, `memory/versioning.ts` | Installed-package HTTP coverage, typechecked examples, and unit coverage |
| Multi-tenant, serialization, encryption | `local-consumer`, public helpers from `src/multi-tenant`, `src/serialization`, `src/encryption` | Installed-package HTTP coverage plus unit coverage |
| API versioning and events/webhooks | `local-consumer`, public helpers from `src/api-version` and `src/events` | Installed-package HTTP coverage plus unit coverage |
| Rate limiting, health, OpenAPI UI | `memory/rate-limiting.ts`, `memory/basic-crud.ts`, all `comprehensive.ts` files | Typechecked examples, Workers coverage for KV rate-limit, runtime health checks |
| Class, functional, builder, config APIs | `memory/alternative-apis.ts` | Memory alternative API app imported by Vitest |
| Local file install consumer app | `local-consumer` | Builds the package, installs it via `file:../..`, starts a Hono server, and runs a feature test over HTTP |
| Memory adapter | `memory/*.ts` | Memory comprehensive app imported by Vitest |
| Drizzle/Postgres adapter | `drizzle/*.ts` | Drizzle comprehensive app imported by Vitest |
| Prisma/Postgres adapter | `prisma/*.ts` | Prisma comprehensive app imported by Vitest |
| Drizzle D1/Workers adapter | `drizzle/d1-crud.ts` | Workers Vitest imports the D1 app and drives D1 requests |
| Drizzle schema generation | `drizzle/with-drizzle-zod.ts` | Typechecked example |

## Importable Example Contract

Examples that are used by tests export stable app instances or factories. Demo
server startup is kept behind `start()` or a main guard so importing the example
does not bind a port.

The tested comprehensive examples expose:

| Adapter | Export |
| --- | --- |
| Memory | `examples/memory/comprehensive.ts` exports `app` and `start()` |
| Drizzle/Postgres | `examples/drizzle/comprehensive.ts` exports `app` and `start()` |
| Prisma/Postgres | `examples/prisma/comprehensive.ts` exports `app` and `start()` |
| Drizzle D1/Workers | `examples/drizzle/d1-crud.ts` exports `openApiApp` and a Worker default export |

## Direct Request Examples

```bash
curl -X POST http://localhost:3456/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'

curl "http://localhost:3456/users?role=admin"
curl "http://localhost:3456/users?include=posts,profile"
curl "http://localhost:3456/users?search=alice"
curl "http://localhost:3456/users?age[gte]=18&age[lte]=65"
curl "http://localhost:3456/users?page=1&per_page=20"
```

## Troubleshooting

Check Postgres:

```bash
cd examples
docker compose ps
docker compose logs postgres
docker compose restart postgres
```

Reset Prisma schema:

```bash
pnpm run prisma:generate
pnpm exec prisma db push --schema=examples/prisma/schema.prisma --config=examples/prisma/prisma.config.ts --force-reset
```

Stop the local database:

```bash
pnpm run db:down
```
