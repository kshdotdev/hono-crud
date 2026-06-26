# @hono-crud/mcp

## 0.1.11

### Patch Changes

- 855fe4a: Make framework-bridge (e.g. @velajs/crud) CRUD resources MCP-discoverable, and fix `tools/list` for schemas with date fields.

  - `hono-crud/internal` now exports `recordCrudResource`, so a bridge that mounts generated CRUD routes via a sub-app can also record the resource on the parent app — where `getRegisteredCrudResources(app)` (and `@hono-crud/mcp`'s `auto` discovery) read it. Previously such resources were recorded only on the isolated sub-app and were invisible to MCP.
  - `@hono-crud/mcp`: `buildInputShape` now coerces tool-input fields the MCP SDK cannot represent in JSON Schema (e.g. `z.date()`) to a representable string, preserving optionality, instead of letting the SDK's `toJSONSchema` throw and break the entire `tools/list`. (Query/body dates arrive as strings on the wire anyway, so endpoints still parse them.)

## 0.1.10

### Patch Changes

- a50d497: Core structure consolidation (internal — public import surface unchanged except three dead exports):

  - One canonical CRUD route table (`CRUD_ROUTES`, exported via `hono-crud/internal`): all 22 endpoint slots as ordered `[name, verb, subPath]` rows with the registration-order invariants documented in one place. `registerCrud`'s 125-line if-chain is now a loop over it; the OpenAPI paths emitter's private duplicate table is gone; `CrudEndpointName` is derived from the table so it can never drift.
  - Health is now a core subpath: `hono-crud/health` replaces the retired `@hono-crud/health` package (same API; zero deps and zero core coupling made a separate package pure overhead).
  - New `hono-crud/cloudflare` module home (merges the former `types/` and `shared/` single-file directories).
  - "Phase E" finished: auth context accessors live in `auth/context.ts` (also exported from `hono-crud/auth`), the back-compat shim `core/context-helpers.ts` is gone, and context reads use `CONTEXT_KEYS` constants instead of string literals.
  - One canonical helper each: `getClientIp` (the `trustProxy` knob is now honored, library-wide default `true` — edge-first; logging middleware previously discarded `trustProxy: false`), one `PathPattern` (auth/logging/rate-limit re-export it), logging's pure delegation shims deleted.
  - Removed dead exports: `createNullableRegistry`, `createRegistryWithDefault`, `PerTenantOpenApiConfig` (use `OpenAPIConfig`).

- 55577a9: BREAKING: export-surface rewrite — the root barrel owns only the CRUD core; every feature family is importable only from its subpath.

  The rule: each `hono-crud/<feature>` subpath barrel is the complete canonical surface of its feature family; the root `'hono-crud'` barrel owns only the CRUD core (model/meta, router/registrar, endpoint classes + result types, exceptions/error-handler, generic context helpers, core infra utils, OpenAPI utilities) and never exports renamed aliases; `hono-crud/internal` is now an explicit curated list (no `export *`).

  Evicted from the root barrel (import from the subpath instead):

  - `hono-crud/auth` — all middleware/guards/storage/validators/JWT-claims plus the auth context accessors (`getUser`, `getUserId`, `hasRole`, …) and types (`AuthEnv`, `JWTClaims`, `ApprovalStorage`, …).
  - `hono-crud/logging` — `createLoggingMiddleware`, storage setters/getters, redact/extract/truncate utilities, `MemoryLoggingStorage`, `getRequestStartTime`, logging types. (`getRequestId`/`generateRequestId` remain on the root as generic context helpers.)
  - `hono-crud/storage` — `createStorageMiddleware` + per-feature storage middlewares, `getStorage(ctx, key)` and resolvers, `StorageRegistry`, `StorageEnv`, storage contracts.
  - `hono-crud/events` — `CrudEventEmitter`, emitter setters/getters, `registerWebhooks`, `CRUD_EVENT_TYPES`, event/webhook types.
  - `hono-crud/serialization` — `applyProfile` family, `SerializationProfile`/`SerializationConfig`.
  - `hono-crud/encryption` — encrypt/decrypt helpers, `StaticKeyProvider`, `encryptedValueSchema`, encryption types.
  - `hono-crud/api-version` — `apiVersion`, `getApiVersion`, `getApiVersionConfig`, `apiVersionedResponse`, versioning-strategy types.
  - `hono-crud/audit` — `AuditLogger`, `MemoryAuditLogStorage`, `createAuditLogger`, audit storage setters/getters, and (newly on the barrel) `getAuditConfig` + `calculateChanges`.
  - `hono-crud/versioning` — `VersionManager`, `MemoryVersioningStorage`, `createVersionManager`, versioning storage setters/getters, and (newly on the barrel) `getVersioningConfig`.
  - `hono-crud/multi-tenant` — `multiTenant`, `TenantEnv`, `MultiTenantMiddlewareConfig`, and (newly on the barrel) `getMultiTenantConfig` + `extractTenantId`.
  - `hono-crud/functional` — `createCreate`/`createList`/`createRead`/`createUpdate`/`createDelete` and their config types.
  - `hono-crud/builder` (new subpath) — `crud` and the `*Builder` classes.
  - `hono-crud/config` — the endpoint-config types (`CreateEndpointConfig`, …, `EndpointsConfig`, `AdapterBundle`, `GeneratedEndpoints`). `defineEndpoints` (the function) stays on the root.

  Deleted outright (no new home):

  - The rename aliases `getContextRequestId`, `matchLoggingPath`, `extractLoggingUserId`, `LoggingPathPattern` — use `getRequestId` (root), `matchPath`, `extractUserId`, `PathPattern` (all on `hono-crud/logging`).
  - The 17 `Config*Endpoint` type aliases (`ConfigCreateEndpoint`, …) — use the original `*EndpointConfig` names from `hono-crud/config`.
  - `getHandlerForApp` is no longer on the public barrel (it remains module-level in core).

  `@hono-crud/memory`: the `getStorage` export alias is removed — use `getStore`.

  `@hono-crud/mcp`: now imports exclusively from `hono-crud/internal` (no behavior change).

  The model-meta contract types (`AuditConfig`, `VersioningConfig`, `MultiTenantConfig`, `SoftDeleteConfig`, `AuditLogEntry`, `VersionHistoryEntry`, …) stay on the root barrel — they are fields of the model meta, distinct from the feature runtime.

  (Published as a patch per this repo's pre-1.0 versioning policy.)

- daf4007: MCP integration depth batch:

  - **Full operation surface**: `OperationName` widens from 5 hand-picked verbs to every `CrudEndpointName` except `import`, and the default exposure is now every operation present in the resource's endpoints map (matching the long-standing doc comment) — `search`, `aggregate`, `export`, `upsert`, `clone`, `bulkPatch`, the batch verbs, and the version sub-resources all become tools automatically. `ResourceOptions.operations` remains the narrowing allow-list. `import` is excluded by design: its schema declares no request body (manual multi-content-type validation), so an auto-generated tool would advertise an input schema lacking the items payload.
  - **Generic dispatch driven by core's `CRUD_ROUTES`**: the hand-written `METHOD`/`REQUEST_BUILDERS` maps are replaced by one dispatcher that takes the HTTP method and URL template from core's canonical route table, substitutes every `:param` segment from the tool input (unlocking `versionRead`'s `/:id/versions/:version`), and splits the remaining input schema-driven — declared query keys to the query string, the rest as the JSON body when the endpoint declares one (covers `bulkPatch`'s query+body mix and `batchDelete`'s DELETE-with-body), everything as query otherwise.
  - **Configurable header forwarding**: new `CrudMcpConfig.forwardHeaders` (case-insensitive allow-list) controls which inbound `/mcp` headers reach the re-dispatched CRUD request. The default — exported as `DEFAULT_FORWARD_HEADERS` — widens from `authorization`/`cookie` to also cover core's own `x-api-key` (API-key auth) and `x-tenant-id` (header multi-tenancy), which previously broke silently through MCP.
  - **Structured output**: where an endpoint's 2xx response is a JSON-object schema (sole content type, JSON-Schema-representable), the tool now advertises a derived MCP `outputSchema` and returns the parsed 2xx response as `structuredContent` alongside the text content.
  - **Annotation/description defaults for every operation**: read-only hints for search/aggregate/export/version reads, explicit `destructiveHint: false` on non-destructive mutations (the MCP spec defaults it to `true`), `destructiveHint: true` for delete/batchDelete, and `idempotentHint: true` where honest (update/upsert/restore).
  - **Docs fix**: README and JSDoc no longer reference the nonexistent `@hono-crud/core/auth` package and `jwtAuth()` helper — the real spelling is `createJWTMiddleware` from `hono-crud/auth`.

- 08e7e95: Naming & config-shape unification (breaking renames, no aliases).

  **Model feature enablement idiom.** `Model.audit` and `Model.versioning` are now `boolean | Config` like their `softDelete`/`multiTenant` siblings; the required `enabled` field is removed from `AuditConfig` and `VersioningConfig`. Write `audit: true` / `versioning: true` (or a config object — presence enables); `getAuditConfig`/`getVersioningConfig` and the `AuditLogger`/`VersionManager`/`createAuditLogger`/`createVersionManager` config params accept the union. `NormalizedAuditConfig`/`NormalizedVersioningConfig` still carry `enabled`. `fieldEncryption` stays presence-enabled (it has required members).

  **Path-filter and message vocabulary.** `excludePaths` is the one name for "paths this middleware bypasses": `AuthConfig.skipPaths` → `excludePaths`, `RateLimitConfig.skipPaths` → `excludePaths`, and mcp `AutoOptions.include`/`exclude` → `includePaths`/`excludePaths` (they match `registerCrud` mount paths with the same shared matcher). `AuthConfig.unauthorizedMessage` → `errorMessage`, matching rate-limit and multiTenant.

  **Duration unit suffixes (renames only — no field changed its unit).**

  | Old                                                                      | New                              | Unit    |
  | ------------------------------------------------------------------------ | -------------------------------- | ------- |
  | `CacheConfig.ttl`                                                        | `ttlSeconds`                     | seconds |
  | `IdempotencyConfig.ttl`                                                  | `ttlSeconds`                     | seconds |
  | `IdempotencyConfig.lockTimeout`                                          | `lockTimeoutSeconds`             | seconds |
  | `JWTConfig.clockTolerance` / `JWTClaimsValidationOptions.clockTolerance` | `clockToleranceSeconds`          | seconds |
  | `SubscribeEndpointConfig.heartbeatInterval`                              | `heartbeatIntervalMs`            | ms      |
  | `SubscribeEndpointConfig.connectionTimeout`                              | `connectionTimeoutMs`            | ms      |
  | `HealthCheck.timeout`                                                    | `timeoutMs`                      | ms      |
  | `HealthConfig.defaultTimeout`                                            | `defaultTimeoutMs`               | ms      |
  | `WebhookEndpoint.timeout`                                                | `timeoutMs`                      | ms      |
  | `MemoryTtlStoreOptions.cleanupInterval`                                  | `cleanupIntervalMs`              | ms      |
  | `MemoryLoggingStorageOptions.maxAge` / `.cleanupInterval`                | `maxAgeMs` / `cleanupIntervalMs` | ms      |
  | `MemoryIdempotencyStorageOptions.cleanupInterval`                        | `cleanupIntervalMs`              | ms      |
  | `MemoryRateLimitStorageOptions.cleanupInterval`                          | `cleanupIntervalMs`              | ms      |

  Documented exception: `RateLimitResult.retryAfter` keeps its name (mirrors the HTTP Retry-After header, seconds by RFC).

  **Env types.** `TenantEnv` now types its tenant variable optional (`string | undefined` until the middleware runs), matching every other `*Env`. `HonoCrudEnv` now folds in `TenantEnv & ApiVersionEnv`, making its "all core context variables" claim true.

  **Rate-limit extractor nullability.** `extractUserId` and `extractAPIKey` return `string | undefined` (was `string | null`); `KeyExtractor` is `(ctx) => string | undefined` — custom extractors returning `null` must return `undefined`. `extractIP` keeps its `'unknown'` fail-closed sentinel: a falsy key would skip rate limiting entirely, and limits must not fail open when no IP is derivable.

- bf12169: `hono-crud` is now a peerDependency (caret range) instead of an exact-pinned dependency. Previously, published packages pinned the exact core version (e.g. `0.13.13`), so an app on any other core version got two physical copies of `hono-crud` installed — silently corrupting satellite exception codes through `createErrorHandler` (e.g. `RATE_LIMIT_EXCEEDED` degraded to `HTTP_ERROR`, `details.retryAfter` dropped) and breaking `setLogger()` for all adapter logging. The resolver now dedupes onto the app's single copy. npm >= 7 and pnpm >= 8 auto-install peers, so installs are unchanged.

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
