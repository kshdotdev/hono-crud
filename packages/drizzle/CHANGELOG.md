# @hono-crud/drizzle

## 0.1.8

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

## 0.1.7

### Patch Changes

- dd62008: Aggregate filters now fail closed on unknown operators across all adapters. Memory's `MemoryAggregateEndpoint` delegated to its own inline 6-operator switch with a fail-open default (unknown operators matched every record); it now delegates to `matchesFilter()`, the fail-closed single source of truth, and supports all 12 operators. Prisma's aggregate where-builder forwarded unrecognized operator strings verbatim into the Prisma where clause and 500'd on documented operators like `between`/`ilike`; it now validates with `isFilterOperator()` and delegates to `buildPrismaWhere`. Drizzle's aggregate path cast untrusted operator strings and crashed via `assertNever` on unknown operators; it now validates first and pushes a never-true condition instead. In every adapter an unknown operator now matches nothing (count 0) instead of leaking data or crashing.
- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- Updated dependencies [dd62008]
  - hono-crud@0.13.9

## 0.1.6

### Patch Changes

- 255aaf3: Thread a row/DB type generic through both ORM adapters so query results are typed instead of `unknown`, removing the internal `as ModelObject<...>` laundering casts. Breaking: the Drizzle adapter drops the `DrizzleDatabase`/`DrizzleDB` aliases (use `DrizzleDatabaseConstraint` or the new third `DB` generic on endpoint classes) and its public API no longer references drizzle-orm builder types (`Table`/`Column`/`SQL`); `PrismaModelOperations` gains a `Row` type parameter plus `aggregate`/`groupBy` members.

## 0.1.5

### Patch Changes

- b880e53: Type-safety hardening (phase 1): eliminate type/schema drift and silent fall-throughs.

  - **Unify `HonoOpenAPIApp`.** The publicly re-exported type was a 4-verb subset that disagreed with the 7-verb superset `fromHono` actually returns; both now resolve to one canonical definition, so typing the documented `HonoOpenAPIApp` and calling `.options()`/`.head()`/`.doc()` type-checks.
  - **Closed-union exhaustiveness.** Filter-operator handling now goes through a single shared `matchesFilter` in the in-memory adapter (the four copy-pasted switches had drifted — one was missing `between` and silently matched every row), and the Drizzle/Prisma/aggregate switches gained `assertNever` exhaustiveness guards so a future operator is a compile error rather than a silent gap.
  - **Validate untrusted filter operators.** `parseFilterValue` no longer blindly casts an unrecognized `field[op]=value` token to `FilterOperator` (which downstream adapters silently ignored, disabling the filter); unknown operators now fall back to literal equality. `FilterOperator` is now derived from a single `as const` `FILTER_OPERATORS` source with an `isFilterOperator` guard.
  - **Scalar config.** `@hono-crud/scalar` no longer escapes its own typing via `as Record<string, unknown>`; `ScalarTheme` is derived from the upstream `ApiReferenceConfiguration` and `scalarUI` has an explicit return type.
  - **De-duplicated casts.** Added a localized `readResponseEnvelope(ctx)` accessor and a Drizzle `readCount`/`CountRow` helper, removing repeated inline casts.

  New exports: `FILTER_OPERATORS`, `isFilterOperator`, `assertNever`, `readResponseEnvelope` (from `hono-crud`); `readCount`/`CountRow` (from `@hono-crud/drizzle`). All additive; no breaking changes.

- 18a86c2: Type-safety hardening (phase 2): derive types from single `as const` / Zod sources so the compile-time union and its runtime validators can no longer drift.

  - **Union single-sources.** `SortDirection`, `SearchMode`, `AggregateOperation`, `JWTAlgorithm` (core) and `DrizzleDialect` (drizzle) are now derived from exported `as const` arrays (`SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `JWT_ALGORITHMS`, `DRIZZLE_DIALECTS`). The three `z.enum(['asc','desc'])` schemas and the `z.enum(['any','all','phrase'])` schema now reference these arrays, and the aggregate query parser derives its runtime operation lists from `AGGREGATE_OPERATIONS` instead of hand-maintained copies.
  - **Removed a redundant type.** The JWT middleware's `HonoAlgorithm` type and its hand-maintained `supported` allow-list were exact duplicates of `JWTAlgorithm`; both are gone (and with them two casts) — `validateAlgorithm` checks against `JWT_ALGORITHMS` directly.
  - **`SortSpec`.** The repeated inline `{ field: string; order: 'asc' | 'desc' }` shape across list/search/builder/functional/config is now the named `SortSpec` type.
  - **Schema-derived shapes.** `EncryptedValue` is inferred from a new `encryptedValueSchema` and `isEncryptedValue` validates with `.safeParse` (one shape, not a hand-written twin). `CrudEventType` is single-sourced from `CRUD_EVENT_TYPES`, and the webhook event-filter template-literal type derives from it, so a new event type can't silently become unfilterable.

  New additive exports: `SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `SortDirection`, `SortSpec`, `JWT_ALGORITHMS`, `CRUD_EVENT_TYPES`, `encryptedValueSchema` (from `hono-crud`); `DRIZZLE_DIALECTS`, `readCount`, `CountRow` (from `@hono-crud/drizzle`). All derived types are structurally identical to what they replaced — no breaking changes.

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
