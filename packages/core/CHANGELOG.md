# Changelog

## 0.13.9

### Patch Changes

- dd62008: Consolidate the three divergent `executionCtx.waitUntil` helpers onto one guarded implementation (breaking, patch). The public `getWaitUntil` exported from `hono-crud/cloudflare` no longer throws outside a Workers runtime — it now returns `WaitUntil | undefined` like the internal helper always did. `OpenAPIRoute.runAfterResponse` reuses the shared `getWaitUntil` from `utils/wait-until` instead of an inlined copy, and the dead thunk-based `runAfterResponse` free function was removed.

## 0.13.8

### Patch Changes

- f8e5208: `multiTenant()` now fails fast on an inconsistent configuration. Previously, `source: 'custom'` without an `extractor` silently extracted `undefined` on every request and surfaced as a misleading `400 "Tenant ID is required"` (a misconfiguration masquerading as a client error). It now throws a clear setup-time error pointing at the missing `extractor`.
- 3ab0514: Internal: complete the OpenAPI metadata migration to Zod v4's `.meta()` registry — the remaining `.describe()` calls (read/export/import endpoint query parameters) now use `.meta()`, so the entire core no longer uses `.describe()`. The OpenAPI snapshot fixture was expanded to cover the export/import endpoints, and the generated output is unchanged (the snapshot is byte-for-byte identical after the migration). No consumer-facing change.
- 0538c4a: Internal: migrate the list/search query-parameter OpenAPI metadata from `.describe()` to Zod v4's `.meta()` metadata registry, and add a byte-for-byte OpenAPI snapshot test that guards the generated document against regressions. The emitted OpenAPI output is unchanged (the snapshot proves it) — this is a modernization to the canonical Zod v4 metadata API with no consumer-facing impact.
- b880e53: Type-safety hardening (phase 1): eliminate type/schema drift and silent fall-throughs.

  - **Unify `HonoOpenAPIApp`.** The publicly re-exported type was a 4-verb subset that disagreed with the 7-verb superset `fromHono` actually returns; both now resolve to one canonical definition, so typing the documented `HonoOpenAPIApp` and calling `.options()`/`.head()`/`.doc()` type-checks.
  - **Closed-union exhaustiveness.** Filter-operator handling now goes through a single shared `matchesFilter` in the in-memory adapter (the four copy-pasted switches had drifted — one was missing `between` and silently matched every row), and the Drizzle/Prisma/aggregate switches gained `assertNever` exhaustiveness guards so a future operator is a compile error rather than a silent gap.
  - **Validate untrusted filter operators.** `parseFilterValue` no longer blindly casts an unrecognized `field[op]=value` token to `FilterOperator` (which downstream adapters silently ignored, disabling the filter); unknown operators now fall back to literal equality. `FilterOperator` is now derived from a single `as const` `FILTER_OPERATORS` source with an `isFilterOperator` guard.
  - **Scalar config.** `@hono-crud/scalar` no longer escapes its own typing via `as Record<string, unknown>`; `ScalarTheme` is derived from the upstream `ApiReferenceConfiguration` and `scalarUI` has an explicit return type.
  - **De-duplicated casts.** Added a localized `readResponseEnvelope(ctx)` accessor and a Drizzle `readCount`/`CountRow` helper, removing repeated inline casts.

  New exports: `FILTER_OPERATORS`, `isFilterOperator`, `assertNever`, `readResponseEnvelope` (from `hono-crud`); `readCount`/`CountRow` (from `@hono-crud/drizzle`). All additive; no breaking changes.

- a41b5d7: Type-safety hardening (phase 2, deferred items): validate the JWT trust boundary and single-source the error envelope.

  - **Validate JWT claims (security).** The JWT middleware previously coerced the verified payload to `JWTClaims` with a blind `payload as unknown as JWTClaims` cast — Hono's `verify` checks the signature and `exp`/`nbf` timing but not claim _shapes_, so a structurally malformed payload was trusted. The verified payload now runs through `safeParseJWTClaims`; a payload that fails the schema is rejected with `401 Invalid token claims`. `JWTClaimsSchema` was extended with the identity claims the default extractor reads (`email`, `role`, `roles`, `permissions`, `metadata`), and `JWTClaims` is now derived from it (single source). The wrong `secret as string` cast (which mistyped a `CryptoKey` secret) was removed.
  - **Fix role normalization.** `defaultExtractUser` previously assigned a singular `role` claim straight to `AuthUser.roles`, producing a value mistyped as `string[]`. `role` / single-string `roles` claims are now normalized to a string array.
  - **Single-source the error envelope.** The `{ success: false, error: { code, message, details? } }` contract was hand-restated as TS types in `core/types.ts`, as the return type of `ApiException.toJSON()`, and inline in the idempotency middleware. There is now one `structuredErrorSchema` / `errorEnvelopeSchema` (plus a `successEnvelopeSchema(result)` factory); `StructuredError` and `ErrorResponse` are derived from them via `z.infer`, `ApiException.toJSON()` returns the shared `ErrorResponse`, and the idempotency bodies use a typed helper bound to it.

  New additive exports: `structuredErrorSchema`, `errorEnvelopeSchema`, `successEnvelopeSchema` (from `hono-crud`).

  **Behavior change:** JWT tokens whose payloads do not match `JWTClaimsSchema` (e.g. a non-numeric `exp`, a non-string `sub`) are now rejected rather than accepted. This is the intended security tightening; the identity claims are typed leniently (`roles`/`permissions` accept a string or array) to avoid rejecting common real-world token shapes.

- 18a86c2: Type-safety hardening (phase 2): derive types from single `as const` / Zod sources so the compile-time union and its runtime validators can no longer drift.

  - **Union single-sources.** `SortDirection`, `SearchMode`, `AggregateOperation`, `JWTAlgorithm` (core) and `DrizzleDialect` (drizzle) are now derived from exported `as const` arrays (`SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `JWT_ALGORITHMS`, `DRIZZLE_DIALECTS`). The three `z.enum(['asc','desc'])` schemas and the `z.enum(['any','all','phrase'])` schema now reference these arrays, and the aggregate query parser derives its runtime operation lists from `AGGREGATE_OPERATIONS` instead of hand-maintained copies.
  - **Removed a redundant type.** The JWT middleware's `HonoAlgorithm` type and its hand-maintained `supported` allow-list were exact duplicates of `JWTAlgorithm`; both are gone (and with them two casts) — `validateAlgorithm` checks against `JWT_ALGORITHMS` directly.
  - **`SortSpec`.** The repeated inline `{ field: string; order: 'asc' | 'desc' }` shape across list/search/builder/functional/config is now the named `SortSpec` type.
  - **Schema-derived shapes.** `EncryptedValue` is inferred from a new `encryptedValueSchema` and `isEncryptedValue` validates with `.safeParse` (one shape, not a hand-written twin). `CrudEventType` is single-sourced from `CRUD_EVENT_TYPES`, and the webhook event-filter template-literal type derives from it, so a new event type can't silently become unfilterable.

  New additive exports: `SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `SortDirection`, `SortSpec`, `JWT_ALGORITHMS`, `CRUD_EVENT_TYPES`, `encryptedValueSchema` (from `hono-crud`); `DRIZZLE_DIALECTS`, `readCount`, `CountRow` (from `@hono-crud/drizzle`). All derived types are structurally identical to what they replaced — no breaking changes.

## 0.13.7

### Patch Changes

- 245ca0b: docs: add the project logo and a centered README header (logo, description, and npm/downloads/tests/size/license badges).

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
