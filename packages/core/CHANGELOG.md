# Changelog

## 0.13.6

### Patch Changes

- 3278d26: Internal refactor: deduplicate endpoint read-shaping, centralize context keys, and type the config "extras" bridge.

  - **Fix (security):** `restore`, `search`, `clone`, `upsert`, and the batch endpoints now apply `model.serializationProfile` to their responses. Previously they serialized records without it, leaking fields the profile was meant to strip. If you relied on those endpoints returning profile-excluded fields, update your expectations.
  - Endpoint output shaping (computed fields → serializer → serialization profile → transform → field selection) is now a single shared pipeline (`finalizeRecord` / `finalizeArray`) instead of being copy-pasted per endpoint.
  - Centralized the Hono context-variable keys behind `CONTEXT_KEYS` and removed several internal deprecation shims; public exports are unchanged.
  - The config-API "extras" for extended verbs are now compile-time typed, so a misspelled option key is a build error instead of being silently ignored.
  - **Breaking (types):** the parser-side `ListEndpointConfig` type export was renamed to `ListFilterParseOptions`. The config-API list type is unchanged (still exported as `ConfigListEndpoint`). `ModelObject` is retained as a deprecated alias of `InferModel`.
  - Added `hono-crud/config` and `hono-crud/functional` subpath exports (parity with the other feature modules).
  - `registerCrud` now accepts `bulkPatch`, `versionHistory`, `versionRead`, `versionCompare`, and `versionRollback` slots, wiring them to their conventional routes instead of requiring manual `app.patch`/`app.get` calls.

## 0.13.5

### Patch Changes

- c95d8dc: `registerCrud(...)` now records each resource on the app instance (app-scoped, startup-time, edge-safe), and `hono-crud/internal` exports `getRegisteredCrudResources(app)` plus the `RegisteredCrudResource` type. This lets addon packages (e.g. `@hono-crud/mcp`) enumerate registered CRUD resources. `hono-crud/internal` also now exports `extractBearerToken(ctx)` (the default `Authorization: Bearer` extractor) for reuse by first-party addons. No behavior change for existing apps.

## 0.13.4

### Patch Changes

- 6c22eaa: Restructure the project into a pnpm-workspaces monorepo. `hono-crud` is now the thin core; the database adapters, documentation UIs, and optional middleware ship as separate installable packages under the `@hono-crud/*` scope:

  - `@hono-crud/memory`, `@hono-crud/drizzle`, `@hono-crud/prisma` — CRUD adapters (was `hono-crud/adapters/*`)
  - `@hono-crud/swagger`, `@hono-crud/scalar` — documentation UIs (was exported from the `hono-crud` barrel / `hono-crud/ui`)
  - `@hono-crud/cache`, `@hono-crud/rate-limit`, `@hono-crud/idempotency`, `@hono-crud/health` — optional middleware (was `hono-crud/{cache,rate-limit,idempotency,health}`)

  Breaking: these symbols are no longer re-exported from `hono-crud`; install the corresponding `@hono-crud/*` package and import from it. The unified `createCrudMiddleware`, `HonoCrudEnv`, and `StorageEnv` no longer cover cache/rate-limit/idempotency — compose those packages' own middleware instead. A `hono-crud/internal` entrypoint is available for authoring adapters.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b

## [0.8.0] — 2026-05-03

### Added

- `middlewares?: MiddlewareHandler[]` slot on every per-endpoint config in `EndpointsConfig<M>` (`create`, `list`, `read`, `update`, `delete`, `search`, `aggregate`, `restore`, `batchCreate`, `batchUpdate`, `batchDelete`, `batchRestore`, `batchUpsert`, `export`, `import`, `upsert`, `clone`). Middleware listed here runs before the endpoint handler. The existing `RegisterCrudOptions.endpointMiddlewares` continues to work and overrides config-API middlewares for the same verb. Coverage: `tests/per-endpoint-middlewares.test.ts`.

### Fixed

- `HonoOpenAPIHandler.registerRoute` was passing the OpenAPI-style path (`/widgets/{id}`) to `app.use(...)` for per-route middleware. Hono's `use` expects the route-syntax form (`/widgets/:id`), so middleware on dynamic-segment routes (e.g., `delete`, `read`, `update`, `restore`, `clone`) silently never fired. The fix passes the raw path to `app.use(...)` and keeps the OpenAPI conversion only for `createRoute({ path })`. This unblocks both the new config-API `middlewares` slot and the existing `RegisterCrudOptions.endpointMiddlewares` option on `:id` routes.

### Compatibility

- Additive. Existing consumers see no behaviour change other than the bugfix above (middleware that previously was silently dropped on `:id` routes will now run as documented).

%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b

## [0.1.0] - 2025-01-29

### Added

- Initial release
- Full CRUD operations (Create, Read, Update, Delete)
- OpenAPI/Swagger documentation generation
- Swagger UI and Scalar API reference support
- Memory adapter for prototyping and testing
- Drizzle ORM adapter with transaction support
- Prisma adapter with transaction support
- Zod schema validation
- TypeScript support with full type inference
- `setContextVar` helper for context variable management
- `HonoCrudEnv` type export for custom middleware
- Configurable pagination and filtering
- Custom route overrides
- Edge runtime support (Cloudflare Workers, Deno, Bun, Node.js)

[0.1.0]: https://github.com/ksh-us/hono-crud/releases/tag/v0.1.0
[0.1.1]: https://github.com/ksh-us/hono-crud/compare/v0.0.0...v0.1.1
[0.1.2]: https://github.com/ksh-us/hono-crud/compare/v0.1.1...v0.1.2
[0.1.3]: https://github.com/ksh-us/hono-crud/compare/v0.1.2...v0.1.3
[0.1.4]: https://github.com/kshdotdev/hono-crud/compare/v0.1.3...v0.1.4
[0.2.0]: https://github.com/kshdotdev/hono-crud/compare/v0.1.4...v0.2.0
[0.3.0]: https://github.com/kshdotdev/hono-crud/compare/v0.2.0...v0.3.0
[0.3.1]: https://github.com/kshdotdev/hono-crud/compare/v0.3.0...v0.3.1
[0.3.2]: https://github.com/kshdotdev/hono-crud/compare/v0.3.1...v0.3.2
[0.4.0]: https://github.com/kshdotdev/hono-crud/compare/v0.3.2...v0.4.0
[0.4.1]: https://github.com/kshdotdev/hono-crud/compare/v0.4.0...v0.4.1
[0.4.2]: https://github.com/kshdotdev/hono-crud/compare/v0.4.1...v0.4.2
[0.4.3]: https://github.com/kshdotdev/hono-crud/compare/v0.4.2...v0.4.3
[0.4.4]: https://github.com/kshdotdev/hono-crud/compare/v0.4.3...v0.4.4
[0.5.0]: https://github.com/kshdotdev/hono-crud/compare/v0.4.4...v0.5.0
[0.5.1]: https://github.com/kshdotdev/hono-crud/compare/v0.5.0...v0.5.1
[0.5.2]: https://github.com/kshdotdev/hono-crud/compare/v0.5.1...v0.5.2
[0.5.3]: https://github.com/kshdotdev/hono-crud/compare/v0.5.2...v0.5.3
[0.6.0]: https://github.com/kshdotdev/hono-crud/compare/v0.5.3...v0.6.0
[0.7.0]: https://github.com/kshdotdev/hono-crud/compare/v0.6.0...v0.7.0
[0.8.0]: https://github.com/kshdotdev/hono-crud/compare/v0.7.0...v0.8.0
[0.9.0]: https://github.com/kshdotdev/hono-crud/compare/v0.7.0...v0.9.0
[0.10.0]: https://github.com/kshdotdev/hono-crud/compare/v0.9.0...v0.10.0
[0.11.0]: https://github.com/kshdotdev/hono-crud/compare/v0.10.0...v0.11.0
[0.12.0]: https://github.com/kshdotdev/hono-crud/compare/v0.11.0...v0.12.0
[0.12.1]: https://github.com/kshdotdev/hono-crud/compare/v0.12.0...v0.12.1
[0.12.2]: https://github.com/kshdotdev/hono-crud/compare/v0.12.1...v0.12.2
[0.12.3]: https://github.com/kshdotdev/hono-crud/compare/v0.12.2...v0.12.3
[0.12.4]: https://github.com/kshdotdev/hono-crud/compare/v0.12.3...v0.12.4
[0.12.5]: https://github.com/kshdotdev/hono-crud/compare/v0.12.4...v0.12.5
[0.13.0]: https://github.com/kshdotdev/hono-crud/compare/v0.12.5...v0.13.0
[0.13.1]: https://github.com/kshdotdev/hono-crud/compare/v0.13.0...v0.13.1
[0.13.2]: https://github.com/kshdotdev/hono-crud/compare/v0.13.1...v0.13.2
[0.13.3]: https://github.com/kshdotdev/hono-crud/compare/v0.13.2...v0.13.3
