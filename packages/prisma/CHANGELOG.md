# @hono-crud/prisma

## 0.1.16

### Patch Changes

- 29f12a3: fix(security): scope aggregate/search/export/bulk-patch verbs to the caller's tenant

  `GET /resource/aggregate`, `GET /resource/search`, `GET /resource/export`, and
  `PATCH /resource/bulk` built their WHERE clause from the parsed request filters
  **without** applying the model's `multiTenant` owner filter. Only `ListEndpoint`
  re-applied the tenant scope in its handler; these four verbs did not (and
  `ExportEndpoint` overrides `ListEndpoint.handle`, so it didn't inherit it). A
  caller could therefore aggregate, search, export, or bulk-patch across **every
  tenant's rows**, regardless of `Model.multiTenant`.

  Owner-scoping is now centralized in a single auditable core helper,
  `applyTenantScope` (plus `applyTenantScopeToAggregateFilters` for the aggregate
  `Record`-shaped WHERE), which `ListEndpoint` and all four verbs call after
  parsing filters and before running the query. Each verb now enforces tenant
  presence (`validateTenantId`, 400 `TENANT_REQUIRED` when required) and ANDs the
  owner equality into the adapter WHERE — so a tenant's aggregate counts, search
  hits, export rows, and bulk-patch matches are confined to its own rows.

  A second leak on the same verbs is also closed: `search` and `export` loaded
  `?include=` relations WITHOUT the owner `scope` that `list`/`read` pass, so an
  embedded related row could cross tenants even when the parent rows were scoped.
  All three adapters (drizzle, memory, prisma) now thread `getRelationScope(...)`
  into the search/export relation loader, matching List.

  Covered by a new cross-adapter conformance cell (`extended-verb-tenant-scoping`)
  asserting per-tenant aggregate counts (incl. a grouped aggregation), search /
  export / bulk-patch isolation, the `TENANT_REQUIRED` contract, AND that
  `?include=` on search/export never embeds another tenant's related row — across
  the memory and drizzle legs.

## 0.1.15

### Patch Changes

- 26a6ecf: fix(security): scope batch verbs to the caller's tenant

  `batchDelete`, `batchUpdate`, and `batchRestore` operated on a client-supplied
  id list without applying the model's `multiTenant` owner filter — unlike the
  single-row verbs, which get it via core-injected `additionalFilters`. A caller
  could delete, update, or restore **another tenant's rows** by passing their ids.

  Core now enforces tenant presence in each batch handler (`validateTenantId`,
  400 `TENANT_REQUIRED` when required), and exposes `getTenantScopeFilter()` which
  each adapter ANDs into its batch WHERE (drizzle/memory) or `findMany` lookup
  (prisma). Cross-tenant ids now fall through to `notFound`; the row is untouched.

  Covered by a new cross-adapter conformance cell (`batch-tenant-scoping`).

## 0.1.14

### Patch Changes

- 2314cf6: Push owner-scoped relation includes (`?include=`) down to the adapter query.

  The owner-scope filter on relation includes ran as a **post-fetch** filter in the
  core orchestrator: related rows were fetched by foreign key, then cross-tenant /
  soft-deleted ones were dropped before the response. Now the resolved scope (tenant
  column + value, soft-delete column) is threaded into each adapter's `fetchRelated`,
  so the filter is pushed into the **WHERE clause** (drizzle / prisma) or the store
  scan (memory) — the disallowed rows are never fetched. The core orchestrator keeps
  its post-fetch `applyRelationScope` as a defense-in-depth net for adapters that
  ignore the scope argument.

  Adds the internal `RelationFetchScope` type + `resolveFetchScope`; the
  `FetchRelated` / `SyncFetchRelated` types gain an optional 4th `scope` argument
  (backward-compatible — a 3-arg adapter `fetchRelated` stays assignable). Also adds
  a cross-adapter relation-scoping conformance cell (runs on memory + drizzle; a
  named skip on the prisma leg, whose fixed examples schema has no self-relation).

## 0.1.13

### Patch Changes

- 4ba4a85: Owner-scope relation includes (`?include=`) — security fix for cross-tenant exposure.

  Previously, loading a relation via `?include=` fetched the related rows by foreign key alone, ignoring the **related** model's access scope. A caller who could read a parent row could therefore read a related row in another tenant (or a soft-deleted one) through the include — a cross-tenant data leak.

  Relations can now declare a `scope` naming the related table's owner and soft-delete columns:

  ```ts
  relations: {
    post: {
      type: 'belongsTo', model: 'posts', table: posts,
      foreignKey: 'postId', localKey: 'id',
      scope: { tenantField: 'authorId', softDeleteField: 'deletedAt' },
    },
  }
  ```

  When set, included related rows are filtered to the request's resolved tenant id and exclude soft-deleted rows (unless `?withDeleted=true`), so a foreign key pointing at another tenant's row resolves to `null` (belongsTo/hasOne) or is omitted (hasMany). The filtering lives in the core orchestrator (`batchLoadRelations` / `loadRelationsForItem`), so it applies identically across the drizzle, memory, and prisma adapters; the endpoint threads the parent request's tenant id + `withDeleted` into `IncludeOptions.scope` (Read via core; List via each adapter).

  New public types: `RelationScopeConfig`, `RelationRequestScope`; new fields `RelationConfig.scope` and `IncludeOptions.scope`; new protected `getRelationScope()` on the endpoint base class.

  Backward-compatible and opt-in: relations without `scope` (or requests that resolve no tenant) behave exactly as before. Declare `scope` on any relation whose related model is access-scoped to close the leak.

  Note: scoping is applied as a post-fetch filter in the orchestrator (related rows are fetched, then filtered before being mapped back onto the parent — they never reach the response), not yet pushed down to the adapter `WHERE`/`where`. Correct and leak-free; pushing the predicate into the query is a performance follow-up.

## 0.1.12

### Patch Changes

- 376d8d8: Adapter correctness batch:

  - **Prisma soft-delete**: `read` and `update` now exclude soft-deleted rows (previously deleted data stayed readable and updatable on Prisma only), and `PrismaUpdateEndpoint` implements `findExisting` — restoring write policies, ETag If-Match, versioning, and audit prior-state capture that silently no-oped.
  - **Prisma wiring parity**: new `getPrismaClient` resolver (`_tx` → class field → `CONTEXT_KEYS.prismaClient` context slot) and `createPrismaCrud(prisma, meta)` factory mirroring the Drizzle adapter; the `prisma` class field is now optional.
  - **Upsert match-and-restore**: upsert/import/batchUpsert now match soft-deleted rows and clear the soft-delete field on update, identically across all three adapters (previously single upsert skipped soft-deleted rows — unique-constraint errors on SQL — while batch upsert overwrote them without restoring). Drizzle native ON CONFLICT paths document their divergence.
  - **BatchDelete** responses go through the full finalize pipeline (computed fields, serialization profile, transform) instead of serializer-only.
  - **like/ilike contract**: one cross-adapter definition — literal substring needle (`%` stripped, `_` inert), `like` follows database collation case behavior, `ilike` always case-insensitive. Drizzle no longer passes live user wildcards into SQL LIKE and no longer emits PostgreSQL-only `ILIKE` on sqlite/mysql.
  - **Workers waitUntil**: logging flush, cache invalidation (`withCacheInvalidation`), api-key `updateLastUsed`, and error-handler hooks now register through `waitUntil` so they survive the response on Cloudflare Workers. `emitAsync` removed (zero call sites). One exported `WaitUntil` type (`WaitUntilFn` removed).
  - **Prisma LIKE wildcard leak**: Prisma's `contains` compiles to SQL LIKE without escaping, so user-supplied `_` acted as a live single-char wildcard in like/ilike filters and search (verified against Postgres). Needles are now escaped via `escapeLikeWildcards`.
  - **Prisma `useTransaction` honored**: Create/Update/Delete now wrap `handle()` in `$transaction` when `useTransaction = true` (mirroring Drizzle) — previously the flag existed but did nothing on single-record verbs, so hooks saw no transaction and an after-hook throw did not roll back the write.

- e121270: Docs truth sweep — every shipped code sample now typechecks against the real API, plus the type-level fixes that pass surfaced:

  - `withCache` / `withCacheInvalidation` / `withAuth` now accept abstract base classes and return an extendable constructor type. The documented `class X extends withCache(MemoryReadEndpoint)` pattern previously failed to compile for consumers (adapter endpoint classes are abstract, and the old `TBase & Constructor<...>` return type could not be extended — TS2510). Behavior unchanged; types only (`AbstractConstructor` is exported from `hono-crud/internal`).
  - `PendingActionSchema` is now exported from `hono-crud/auth` — its JSDoc already directed storage-adapter authors to validate rows with it, but it was never re-exported.
  - `PrismaClient` (the structural client constraint) is now exported from `@hono-crud/prisma` so consumers can name the type that `prisma = ...` and `createPrismaCrud(...)` accept.
  - Corrected shipped JSDoc: the `withCache` and `AuthenticatedEndpoint` examples no longer show a `handle(ctx)` override (the registrar injects context; `handle()` is parameterless), and the lifecycle-hook docs no longer claim `fire-and-forget` is the default `afterHookMode` (the default is `sequential`).

- fd3895f: Cursor pagination is now real on all three adapters. Previously core advertised cursor query params and `next_cursor`/`prev_cursor` response fields, but only the memory adapter implemented them — Drizzle and Prisma silently fell back to offset pagination.

  - **Drizzle**: keyset via `WHERE cursorField > decoded ORDER BY cursorField LIMIT n+1`; **Prisma**: native `cursor` + `skip: 1` + `take: n+1`. All three adapters build the cursor-mode `result_info` envelope through one shared core helper, so the shape is byte-identical.
  - **`prev_cursor` removed** (breaking): cursor walks are next-only (Stripe-style) — SQL keyset "previous" requires a reversed query and was only ever implemented in memory.
  - **`order_by` is forced to the cursor field during cursor walks** (documented on the query param) — previously the three adapters could diverge on sort semantics mid-walk.
  - **No silent degradation**: cursor query params and `next_cursor` only appear in the OpenAPI schema when the endpoint enables cursor pagination AND the adapter supports it; enabling it on an unsupporting adapter throws `ConfigurationException` instead of quietly serving offset pages.
  - List-query logic deduplicated per adapter (`executeDrizzleListQuery` / memory store query helper, mirroring Prisma's existing `executePrismaQuery`) and batch OpenAPI scaffolding shared by the three id-keyed batch verbs.

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

- 7a7808d: Verb & sugar-surface parity batch:

  - **Config API verb parity**: `defineEndpoints` gains the 5 missing verbs — `bulkPatch`, `versionHistory`, `versionRead`, `versionCompare`, `versionRollback` — completing all 22 `registerCrud` slots. `AdapterBundle` gains the matching optional slots, and all three first-party bundles (Memory/Drizzle/Prisma) now fill every slot. `GeneratedEndpoints` is derived as a `Pick` over `CrudEndpoints`, so the two types can never drift again.
  - **Loud config failure (BREAKING)**: configuring a verb whose adapter bundle lacks the matching base class now throws a plain `Error` at definition time instead of silently skipping the route. Correct configurations are unaffected.
  - **BulkPatch on every adapter**: new `DrizzleBulkPatchEndpoint` (single `UPDATE ... WHERE` + RETURNING) and `PrismaBulkPatchEndpoint` (`updateMany`; count-only, `returnRecords` unsupported). `MemoryBulkPatchEndpoint` now respects soft-delete visibility (soft-deleted rows are never patched) and bumps managed `updatedAt` — previously it patched deleted rows and skipped the timestamp bump. Core `BulkPatchEndpoint` ships a default `getUpdateSchema()` (model schema minus managed fields, partial) so it works from the config API without subclassing. New conformance cell pins the contract on all three adapters.
  - **OpenAPI schema overrides now actually merge (fix)**: user-supplied `responses`/`request`/`security`/`operationId` previously type-checked but were clobbered by the generated blocks on every surface. A shared `mergeRouteSchema` seam (exported from `hono-crud`) now merges user blocks over the generated schema in every endpoint `getSchema()`. Config `openapi` widened to `Partial<OpenAPIRouteSchema>` and the builder gains `.openapi(schema)`.
  - **`searchFieldName` → `searchParamName` (BREAKING)**: the list-endpoint inline-search query-param knob is renamed everywhere (`ListEndpoint`, `ListFilterParseOptions`, functional `ListConfig`, `NormalizedEndpointConfig`); it names a query parameter, not a model field. Builder `.searchParam()` and config `search.paramName` spellings are unchanged. The default divergence is deliberate and now documented: inline list search defaults to `'search'`, the dedicated `/search` route to `'q'`.
  - **Builder alias removal (BREAKING)**: pre-1.0 back-compat aliases `orderBy()` and `defaultOrder()` are deleted — `.sortable()` / `.defaultSort()` are the only spellings. The builder also no longer hardcodes its own copy of factory defaults (20/100/'search'/'id'/'sequential'/false); unset knobs pass `undefined` through so `generateEndpointClass` is the single source of defaults (behavior identical).
  - **`bodySchema` parity**: functional `CreateConfig`/`UpdateConfig` gain `bodySchema` and the Create/Update builders gain `.bodySchema(schema)`, matching the class and config APIs. Fixed a factory bug where the generated `getBodySchema` override crashed body-schema-less verbs.
  - **Honest hook typing**: the core create/update/delete trio across functional/builder/config now types the hook context as the exported `HookContext` (previously the actively-wrong `tx?: unknown`) and reuses the exported `AfterUpdateHook`/`AfterDeleteHook` aliases. Extended-verb config hook bags are retyped to what is actually passed (upsert gets `isCreate: boolean`, batch-create gets per-item `(item, index)`, batch-update gets `(id, data)`, import gets `(row, rowNumber, mode, tx?)`, clone's `before` gets the prepared clone payload; phantom `tx` params that were never passed are dropped). Previously-dead config hooks now fire: `search.hooks.after` is wired to `afterSearch`, `batchUpsert.hooks.before/after` to `beforeBatch`/`afterBatch`, and `AggregateEndpoint` gains an `after(result)` lifecycle hook so `aggregate.hooks.after` works.
  - **Env-generic config middlewares**: `EndpointsConfig<M, E>` threads `E` so per-endpoint `middlewares` are `MiddlewareHandler<E>[]`, matching the functional and builder surfaces.

## 0.1.11

### Patch Changes

- Updated dependencies [66f789c]
  - hono-crud@0.13.13

## 0.1.10

### Patch Changes

- Updated dependencies [1b4c5dd]
  - hono-crud@0.13.12

## 0.1.9

### Patch Changes

- 97e92f5: Dedup batch: the edge-safe in-memory TTL machinery, the cache entry wire format, and the relation-batching control flow each now live in exactly one place.

  - New internal `MemoryTtlStore` in core (exported via `hono-crud/internal`) owns lazy cleanup-on-access, expiry-on-read, and insertion-order capacity eviction. The cache, rate-limit, and idempotency memory storages compose it, supplying only their entry shapes and domain indices (cache tag index via an eviction hook, idempotency locks as a second store). Public constructor options are unchanged. The logging memory storage intentionally stays standalone — its newest-first ordering is a different structure, not drift.
  - New cache entry codec (`packages/cache/src/entry.ts`, internal): `buildCacheEntry` / `normalizeStoredEntry` / `isCacheEntryExpired` shared by the memory, Redis, and Cloudflare KV backends — including the single canonical legacy-Date migration guard, so already-persisted entries keep reading identically.
  - New relation-batching orchestrator in core (exported via `hono-crud/internal`): the ORM-agnostic control flow (key collection, grouping, map-back, lookup-map dispatch over hasOne/hasMany/belongsTo) is shared; drizzle, prisma, and memory supply only their query adapters. N+1 batching fixes now land in one place.
  - Two deliberate behavior fixes that the dedup surfaced: (1) single-item relation reads in the memory and drizzle adapters now always set the relation key (`null` / `[]` instead of absent), matching the batch path and prisma — this also fixes memory's belongsTo gating on the row's own `id` instead of the foreign key; (2) the rate-limit fixed window no longer slides its stored expiry on within-window increments — the window keeps its original `windowStart + windowMs` end.
  - Internal-only removals (never publicly exported): memory's `loadRelation`, prisma's `loadPrismaRelation`.

- Updated dependencies [97e92f5]
  - hono-crud@0.13.11

## 0.1.8

### Patch Changes

- Updated dependencies [8244828]
  - hono-crud@0.13.10

## 0.1.7

### Patch Changes

- dd62008: Aggregate filters now fail closed on unknown operators across all adapters. Memory's `MemoryAggregateEndpoint` delegated to its own inline 6-operator switch with a fail-open default (unknown operators matched every record); it now delegates to `matchesFilter()`, the fail-closed single source of truth, and supports all 12 operators. Prisma's aggregate where-builder forwarded unrecognized operator strings verbatim into the Prisma where clause and 500'd on documented operators like `between`/`ilike`; it now validates with `isFilterOperator()` and delegates to `buildPrismaWhere`. Drizzle's aggregate path cast untrusted operator strings and crashed via `assertNever` on unknown operators; it now validates first and pushes a never-true condition instead. In every adapter an unknown operator now matches nothing (count 0) instead of leaking data or crashing.
- dd62008: Fix `buildPrismaWhere` dropping conditions when a field had more than one filter operator. List and search queries like `?views[gte]=100&views[lte]=200` silently lost the `gte` because each condition overwrote the previous one per field; multiple conditions on one field now combine into a top-level `AND`.
- dd62008: Version rollback now returns 404 `NOT_FOUND` when the target record no longer exists, honoring the endpoint's declared OpenAPI contract. Previously the adapter threw a plain `Error`, which surfaced as 500 `INTERNAL_ERROR`.
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
