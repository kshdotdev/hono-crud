# @hono-crud/idempotency

## 0.1.12

### Patch Changes

- bd322b7: Add a Cloudflare Durable Objects backend for idempotency: `DOIdempotencyStorage` + `IdempotencyDurableObject`.

  KV has no compare-and-swap, so it can't back an atomic idempotency `lock()` — which is why there was deliberately no KV backend. A Durable Object can: each idempotency key maps to its own DO instance (`idFromName(key)`), so different keys never contend while concurrent requests for the _same_ key serialize, and the lock compare-and-set runs inside `blockConcurrencyWhile` for true CAS. This is the edge-native backend Workers users can use instead of Upstash Redis.

  Wiring: export `IdempotencyDurableObject` from your Worker entry, declare the DO binding + a migration in `wrangler.toml`, then `setIdempotencyStorage(new DOIdempotencyStorage(env.IDEMPOTENCY))` (or inject via `createStorageMiddleware`) and add `createIdempotencyMiddleware()`. Types are structural (no `@cloudflare/workers-types` dependency).

## 0.1.11

### Patch Changes

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
- 90ef0da: Storage & middleware-family unification:

  - **RedisIdempotencyStorage** (`@hono-crud/idempotency`): production idempotency backend whose lock acquisition is ONE atomic `SET key value NX PX ttl` round-trip; compatible with `@upstash/redis` (edge-safe) out of the box. Deliberately no Cloudflare KV backend — KV lacks compare-and-swap, so a KV lock would be advisory only (documented in the package README and the `IdempotencyStorage.lock` contract).
  - **Breaking — idempotency error shape**: the middleware now throws `IdempotencyKeyRequiredException` (400 `IDEMPOTENCY_KEY_REQUIRED`) and `IdempotencyConflictException` (409 `IDEMPOTENCY_CONFLICT`) instead of hand-returning `ctx.json` envelopes, so idempotency errors flow through `createErrorHandler` (ErrorMappers / ErrorHooks / custom `responseEnvelope` / requestId injection) like every sibling middleware. Bodies are unchanged under the default envelope on bare Hono apps; with `createErrorHandler` they now honor your envelope and gain `error.requestId`.
  - **Breaking — Prisma model-mapping registry removed**: `registerPrismaModelMapping` / `registerPrismaModelMappings` / `clearPrismaModelMappings` (module-global mutable state, per-isolate on Workers) are deleted. Set the delegate name statically instead: `defineModel({ tableName: 'people', table: 'person', ... })` or `RelationConfig.table` for relations; the camelCase+singularize derivation remains the fallback.
  - **Missing-storage posture unified**: cache mixins and the idempotency middleware now log a once-per-isolate warning when no storage resolves (rate-limit's existing warning gained the same once-guard); idempotency with `required: true` and no storage throws `ConfigurationException` instead of silently voiding replay protection.
  - **Cache default removed**: `getCacheStorage()` no longer lazily installs a global `MemoryCacheStorage` on read (`lazyDefaultOnGet` retired for cache) — it returns honest `null` until storage is configured. Docs no longer claim a memory default exists.
  - **Approval storage joins the unified injection system**: `CONTEXT_KEYS.approvalStorage` slot, `createStorageMiddleware({ approvalStorage })` / `createApprovalStorageMiddleware()`, and the `setApprovalStorage` / `getApprovalStorage` / `getApprovalStorageRequired` / `resolveApprovalStorage` quartet on `hono-crud/auth`. `requireApproval` resolves storage per request (explicit > context > global > warned in-memory default). **Breaking**: `ApprovalConfig.approvalStorage` renamed to `storage` (matching every sibling config).
  - **Quartet uniformity**: every storage feature now exports its full set/get/getRequired/resolve quartet plus registry from its package/subpath barrel (`resolveRateLimitStorage`, `resolveCacheStorage`, `cacheStorageRegistry`, `rateLimitStorageRegistry`, `idempotencyStorageRegistry`, `eventEmitterRegistry`, `getAPIKeyStorageRequired`, `resolveAPIKeyStorage`, logging's Required/resolve pair on `hono-crud/logging`, …).
  - **ConfigurationException sweep**: request-time misconfiguration (audit/versioning manager without storage, `getDrizzleDb` / `getPrismaClient` resolution, `resetRateLimit`, Prisma `$transaction` capability check, `StorageRegistry.getRequired` / `resolveRequired`) now throws `ConfigurationException` (500 `CONFIGURATION_ERROR`) instead of plain `Error`.
  - `MemoryCacheStorageOptions` and `MemoryIdempotencyStorageOptions` are exported; docs now lead every storage-backed feature with `createStorageMiddleware` (the in-code recommended path) and present `set*Storage` as the long-lived-server option.

## 0.1.10

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

## 0.1.9

### Patch Changes

- Updated dependencies [1b4c5dd]
  - hono-crud@0.13.12

## 0.1.8

### Patch Changes

- 97e92f5: Dedup batch: the edge-safe in-memory TTL machinery, the cache entry wire format, and the relation-batching control flow each now live in exactly one place.

  - New internal `MemoryTtlStore` in core (exported via `hono-crud/internal`) owns lazy cleanup-on-access, expiry-on-read, and insertion-order capacity eviction. The cache, rate-limit, and idempotency memory storages compose it, supplying only their entry shapes and domain indices (cache tag index via an eviction hook, idempotency locks as a second store). Public constructor options are unchanged. The logging memory storage intentionally stays standalone — its newest-first ordering is a different structure, not drift.
  - New cache entry codec (`packages/cache/src/entry.ts`, internal): `buildCacheEntry` / `normalizeStoredEntry` / `isCacheEntryExpired` shared by the memory, Redis, and Cloudflare KV backends — including the single canonical legacy-Date migration guard, so already-persisted entries keep reading identically.
  - New relation-batching orchestrator in core (exported via `hono-crud/internal`): the ORM-agnostic control flow (key collection, grouping, map-back, lookup-map dispatch over hasOne/hasMany/belongsTo) is shared; drizzle, prisma, and memory supply only their query adapters. N+1 batching fixes now land in one place.
  - Two deliberate behavior fixes that the dedup surfaced: (1) single-item relation reads in the memory and drizzle adapters now always set the relation key (`null` / `[]` instead of absent), matching the batch path and prisma — this also fixes memory's belongsTo gating on the row's own `id` instead of the foreign key; (2) the rate-limit fixed window no longer slides its stored expiry on within-window increments — the window keeps its original `windowStart + windowMs` end.
  - Internal-only removals (never publicly exported): memory's `loadRelation`, prisma's `loadPrismaRelation`.

- Updated dependencies [97e92f5]
  - hono-crud@0.13.11

## 0.1.7

### Patch Changes

- 8244828: Storage unification (breaking, patch): one injection story and one contract shape for all eight first-party storages.

  - `createCrudMiddleware` / `CrudMiddlewareConfig` are removed. `createStorageMiddleware` is the single injection middleware and now accepts all eight slots (`loggingStorage`, `auditStorage`, `versioningStorage`, `apiKeyStorage`, `cacheStorage`, `rateLimitStorage`, `idempotencyStorage`, `eventEmitter`), each writing the matching `CONTEXT_KEYS` context var. New single-storage factories: `createCacheStorageMiddleware`, `createRateLimitStorageMiddleware`, `createIdempotencyStorageMiddleware`.
  - `CONTEXT_KEYS` (now exported from `hono-crud` and `hono-crud/internal`) is the complete registry of context-var keys, adding `db`, `cacheStorage`, `rateLimitStorage`, `idempotencyStorage`, `rateLimit`, `rateLimitKey`, `responseEnvelope`, `policies`. All key strings are unchanged; cache/rate-limit/idempotency context resolution is now actually live (previously their context tier read keys no middleware wrote).
  - Every storage feature exposes the same two-getter contract: `getXStorage(): T | null` (never throws) plus `getXStorageRequired(): T`. Consequences: `getAuditStorage` / `getVersioningStorage` / `getCacheStorage` return types are now nullable (`getCacheStorage` stays never-null at runtime via its lazy memory default); `getIdempotencyStorage` no longer throws — the old throwing behavior moved to `getIdempotencyStorageRequired`. New: `getLoggingStorageRequired`, `getAuditStorageRequired`, `getVersioningStorageRequired`, `getCacheStorageRequired`, `getRateLimitStorageRequired`, `getIdempotencyStorageRequired`.
  - `VersioningStorage.save(entry)` is renamed to `store(tableName, entry)` — interface method rename; third-party implementations must update. The `entry.id.split(':')` table-name hack is gone and `VersionManager` no longer duck-types.
  - `CacheStorage.set` option `ttl` (seconds) is now `ttlMs` (milliseconds); cache storage constructors take `defaultTtlMs` (default `300_000`) instead of `defaultTtl`. User-facing `CacheConfig.ttl` stays seconds and is converted once in the mixin.
  - `IdempotencyStorage.destroy` is now optional and `cleanup?(): Promise<number>` is part of the optional contract (the memory implementation's cleanup returns the number of entries removed).
  - `APIKeyConfig.lookupKey` is now optional and `APIKeyConfig.storage?: APIKeyStorage` was added; the API-key middleware resolves storage through the registry (explicit > context > global), so `setAPIKeyStorage` is no longer a silent no-op. Configs with neither `lookupKey` nor a resolvable storage throw `ConfigurationException`.
  - The `CacheStorage` / `RateLimitStorage` / `IdempotencyStorage` contracts now live in core and are re-exported by their plugins via `hono-crud/internal` (type identity preserved).
  - Endpoints now thread the request context into audit/versioning managers, so context-injected storage is honored (previously silently ignored).
  - Non-breaking type tightening: `POLICIES_CONTEXT_KEY` narrows from `string` to its literal type.

- Updated dependencies [8244828]
  - hono-crud@0.13.10

## 0.1.6

### Patch Changes

- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- Updated dependencies [dd62008]
  - hono-crud@0.13.9

## 0.1.5

### Patch Changes

- a41b5d7: Type-safety hardening (phase 2, deferred items): validate the JWT trust boundary and single-source the error envelope.

  - **Validate JWT claims (security).** The JWT middleware previously coerced the verified payload to `JWTClaims` with a blind `payload as unknown as JWTClaims` cast — Hono's `verify` checks the signature and `exp`/`nbf` timing but not claim _shapes_, so a structurally malformed payload was trusted. The verified payload now runs through `safeParseJWTClaims`; a payload that fails the schema is rejected with `401 Invalid token claims`. `JWTClaimsSchema` was extended with the identity claims the default extractor reads (`email`, `role`, `roles`, `permissions`, `metadata`), and `JWTClaims` is now derived from it (single source). The wrong `secret as string` cast (which mistyped a `CryptoKey` secret) was removed.
  - **Fix role normalization.** `defaultExtractUser` previously assigned a singular `role` claim straight to `AuthUser.roles`, producing a value mistyped as `string[]`. `role` / single-string `roles` claims are now normalized to a string array.
  - **Single-source the error envelope.** The `{ success: false, error: { code, message, details? } }` contract was hand-restated as TS types in `core/types.ts`, as the return type of `ApiException.toJSON()`, and inline in the idempotency middleware. There is now one `structuredErrorSchema` / `errorEnvelopeSchema` (plus a `successEnvelopeSchema(result)` factory); `StructuredError` and `ErrorResponse` are derived from them via `z.infer`, `ApiException.toJSON()` returns the shared `ErrorResponse`, and the idempotency bodies use a typed helper bound to it.

  New additive exports: `structuredErrorSchema`, `errorEnvelopeSchema`, `successEnvelopeSchema` (from `hono-crud`).

  **Behavior change:** JWT tokens whose payloads do not match `JWTClaimsSchema` (e.g. a non-numeric `exp`, a non-string `sub`) are now rejected rather than accepted. This is the intended security tightening; the identity claims are typed leniently (`roles`/`permissions` accept a string or array) to avoid rejecting common real-world token shapes.

- Updated dependencies [f8e5208]
- Updated dependencies [3ab0514]
- Updated dependencies [0538c4a]
- Updated dependencies [b880e53]
- Updated dependencies [a41b5d7]
- Updated dependencies [18a86c2]
  - hono-crud@0.13.8

## 0.1.4

### Patch Changes

- Updated dependencies [245ca0b]
  - hono-crud@0.13.7

## 0.1.3

### Patch Changes

- Updated dependencies [3278d26]
  - hono-crud@0.13.6

## 0.1.2

### Patch Changes

- Updated dependencies [c95d8dc]
  - hono-crud@0.13.5

## 0.1.1

### Patch Changes

- Updated dependencies [6c22eaa]
  - hono-crud@0.13.4
