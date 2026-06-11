# @hono-crud/mcp

## 0.1.9

### Patch Changes

- 66f789c: Naming + docs sweep (breaking, patch): one name per role across the whole library, and the docs now document the code that exists.

  - Middleware factories: `idempotency()` → `createIdempotencyMiddleware()`. (`multiTenant()`/`apiVersion()` keep their feature-named forms — each anchors an accessor family sharing its prefix; the doctrine in CLAUDE.md documents the rule and the exceptions.)
  - Surface packages are Hono-idiomatic factories you mount yourself: swagger's `setupSwaggerUI`/`setupReDoc`/`setupDocsIndex` (app mutators) become `swaggerUI()`/`redocUI()`/`docsIndex()` returning `MiddlewareHandler` with `SwaggerUIConfig`/`RedocUIConfig`/`DocsIndexConfig` (adopting scalar's `specUrl`/`pageTitle` vocabulary; `UIOptions` deleted); scalar's `setupScalar` is deleted (`app.get(path, scalarUI(config))`); health's `createHealthEndpoints`/`createHealthHandler` collapse into `createHealthRoutes(config): Hono` mounted via `app.route()`.
  - The word "Versioning" now means record history only: HTTP negotiation renames to `ApiVersioningConfig` (was `VersioningMiddlewareConfig`), `ApiVersionStrategy`, `ApiVersionTransformer`, `apiVersionedResponse()`.
  - Multi-tenant has one source-of-truth union: new exported `TenantIdSource` owned by the model-level `MultiTenantConfig`; the middleware config derives from it and renames to `MultiTenantMiddlewareConfig` (was `*Options`). Runtime defaults unchanged.
  - `CrudMcpOptions` → `CrudMcpConfig` per the now-documented Config-vs-Options rule.
  - Rate-limit key prefix unified: one exported `DEFAULT_RATE_LIMIT_KEY_PREFIX = 'rl'`; the KV and Redis storage prefixes no longer add their own divergent defaults ('rl:'/'ratelimit:'), so all backends build identical keys. In-flight rate-limit windows under old prefixes expire naturally.
  - Vestigial `RouterOptions.base`/`docs_url`/`redoc_url` deleted (UI paths live in the swagger/scalar packages; `openapi_url` stays).
  - One API-key hasher: the canonical `hashAPIKey` moves to `auth/hash.ts` and `defaultHashAPIKey` is now an alias of it — hashing is byte-identical, stored keys keep matching.
  - Sorting aliases removed from the functional config: `orderByFields`/`defaultOrderBy`/`defaultOrderDirection` and `SortingConfig.defaultDirection` are gone — canonical `sortFields`/`defaultSort`/`defaultOrder` only.
  - Drizzle's stale 5-verb `DrizzleAdapters` bundle in factory.ts is deleted; the 17-entry bundle in the package barrel is the only one, mirroring prisma and memory.
  - Docs: CLAUDE.md/AGENTS.md gain the naming doctrine and a corrected Drizzle Adapter Pattern section using the real type names (`DrizzleDatabaseConstraint`, `Database<Row>`, `QueryBuilder<Row>`, `cast<Row>()`); all docs/READMEs/examples migrated to the new names and call patterns.

- Updated dependencies [66f789c]
  - hono-crud@0.13.13

## 0.1.8

### Patch Changes

- Updated dependencies [1b4c5dd]
  - hono-crud@0.13.12

## 0.1.7

### Patch Changes

- Updated dependencies [97e92f5]
  - hono-crud@0.13.11

## 0.1.6

### Patch Changes

- Updated dependencies [8244828]
  - hono-crud@0.13.10

## 0.1.5

### Patch Changes

- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- Updated dependencies [dd62008]
  - hono-crud@0.13.9

## 0.1.4

### Patch Changes

- Updated dependencies [f8e5208]
- Updated dependencies [3ab0514]
- Updated dependencies [0538c4a]
- Updated dependencies [b880e53]
- Updated dependencies [a41b5d7]
- Updated dependencies [18a86c2]
  - hono-crud@0.13.8

## 0.1.3

### Patch Changes

- Updated dependencies [245ca0b]
  - hono-crud@0.13.7

## 0.1.2

### Patch Changes

- Updated dependencies [3278d26]
  - hono-crud@0.13.6

## 0.1.1

### Patch Changes

- c95d8dc: Add `@hono-crud/mcp`: auto-generate Model Context Protocol (MCP) tools from hono-crud resources. Introspects the CRUD endpoints you register and exposes `list`/`read`/`create`/`update`/`delete` as MCP tools over HTTP streaming transport, re-dispatching tool calls through the mounted Hono app so they share the full REST pipeline (auth, validation, hooks, serialization, pagination). Register resources explicitly with `mcp.resource(path, endpoints)`, or set `auto: true` to discover and expose every `registerCrud(...)` resource automatically (with include/exclude, default operations, and per-resource overrides). Configurable tool names, descriptions, operation allow-list, and MCP annotations; pluggable bearer-token auth by default with optional MCP OAuth 2.1.
- Updated dependencies [c95d8dc]
  - hono-crud@0.13.5
