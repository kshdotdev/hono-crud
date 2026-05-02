# Local Consumer Example

This app simulates a real project installing `hono-crud` from npm by using a
local file dependency:

```json
"hono-crud": "file:../.."
```

It imports only public package exports, not `../../src`.

From the repo root:

```bash
pnpm run example:local:dev
```

The server runs on `http://localhost:3456` by default and exposes Swagger UI at
`/docs`.

Then try a few routes:

```bash
curl http://localhost:3456/health
curl http://localhost:3456/ready
curl -X POST http://localhost:3456/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","role":"admin","status":"active","age":33}'
curl "http://localhost:3456/users?role=admin&fields=id,email,name,displayName"
curl "http://localhost:3456/users/search?q=Alice"
curl "http://localhost:3456/users/aggregate?count=*&avg=age&groupBy=role"
curl "http://localhost:3456/users/export?format=json"
curl http://localhost:3456/openapi.json
```

Run the local installed-package feature test. It builds `hono-crud`, installs it
through the `file:../..` dependency, starts the API, and exercises CRUD, batch,
upsert, bulk patch, clone, search, aggregate, import/export, relations,
versioning, auth guards, rate limit, idempotency, tenant context, cache,
encryption, serialization, events, audit, health, and OpenAPI routes over HTTP:

```bash
pnpm run example:local:test
```
