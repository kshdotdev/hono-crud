# Changelog

## 0.13.30

### Patch Changes

- fabc720: Cloudflare ergonomics:

  - `hono-crud/cloudflare` exports `runAfterResponse(ctx, promise)` and `createAfterResponse(ctx)` — background work that outlives the response on every runtime (`executionCtx.waitUntil` on Workers, in-band with logged rejections elsewhere). `OpenAPIRoute.runAfterResponse` now delegates to the same implementation.
  - Health checks receive the request context (`check: async (c) => …`), so a readiness probe can reach `c.env` bindings; `createHealthRoutes<Env>` is generic over the app's Env. Zero-argument checks keep working.
  - `AuthType` gains `'session'` for sessions resolved by an external auth library and mapped with `setAuthContext`.
  - `sqliteAuditLogTable()` and `sqliteVersionHistoryTable()` now ship the indexes their storages' lookups need (`(table_name, record_id)` + `(timestamp)`; `(resource_table, record_id, version)`) and accept an `extraConfig` callback for more.
  - New `docs/cloudflare.md`: wrangler template, per-request binding injection, column conventions that keep D1 happy, and the D1/KV limits to design around.

- fabc720: Engine-managed timestamps are now written in the representation each column declares, which makes soft delete and `Model.timestamps` safe on Cloudflare D1 (whose `bind()` rejects objects). Core gains a `managedTimestampValue(field)` hook on `CrudEndpoint` (default `Date.now()`, unchanged for the memory and Prisma adapters) that `applyManagedInsertFields` / `applyManagedUpdateFields` call for `createdAt` / `updatedAt`. The Drizzle adapter overrides it on every write verb — and uses the same rule for the soft-delete marker, which used to bind `new Date()` unconditionally — reading the Drizzle column's `dataType`: `date` columns (`timestamp()`, `integer({ mode: 'timestamp' | 'timestamp_ms' })`) get a `Date`, `number` columns get epoch milliseconds, `string` columns get an ISO-8601 string. New exports: `resolveTimestampValue`, `resolveTimestampRepresentation`, `TimestampRepresentation`.
- fabc720: Query-string filter values are now coerced to the model's declared zod kind before reaching the adapter: `z.number()` fields get numbers, `z.boolean()` fields get booleans (`true`/`1` / `false`/`0`), `z.date()` fields get `Date`s (array operators `in`/`nin`/`between` elementwise; `like`/`ilike` keep the raw string; wrappers such as `.optional()`, `.nullable()`, `.default()` and `z.preprocess`/`.transform` pipes are unwrapped). A value that cannot be coerced (`?age[gte]=abc`, `?done=maybe`) is a 400 `VALIDATION_ERROR` instead of a silent no-match. This fixes typed Drizzle column modes on SQLite/D1, where `integer({ mode: 'boolean' })` read the string `"false"` as truthy and `integer({ mode: 'timestamp' })` threw on a string. `ListFilterParseOptions` gains `fieldSchemas` (the model's `schema.shape`); the list, search and bulk-patch endpoints pass it automatically.
- fabc720: `fromHono()` now fails loudly at setup time when handed a plain `Hono` that already carries registrations (`.use()` middleware or routes) instead of silently discarding them — a plain `Hono` cannot be adopted, so construct the app with `new OpenAPIHono<Env>()` (the plain-`Hono` form is deprecated). The proxy also keeps chaining: a plain handler registration (`app.get(path, handler)`) now returns the proxy, so a following `.get(path, RouteClass)` in the same chain goes through class-route registration. The Drizzle + D1 example was rebuilt on `OpenAPIHono` so its per-request `db` injection and KV response cache actually run, and its stale "`ilike` is unsupported on SQLite" note was removed (it is implemented with `INSTR(LOWER(...))`).
- fabc720: `OpenAPIRoute.getValidatedData()` now returns `multipart/form-data` and `application/x-www-form-urlencoded` bodies. zod-openapi validates those under the `form` target rather than `json`, so `data.body` used to come back `undefined` for every upload endpoint; the validated form value is now read, and the raw fallback parses the body with `parseBody()` when the schema declares a form media type.
- fabc720: Typed RPC client support: apps built with `fromHono` now accumulate Hono's route `Schema` generic, so `hc<typeof app>` from `hono/client` (and `InferRequestType` / `InferResponseType`) work against hono-crud routes.

  - `fromHono(new OpenAPIHono<Env>())` returns `HonoOpenAPIApp<E, S, BasePath>`; every `app.<verb>(path, RouteClass)` call folds the class's schema entry into `S`. Request types are derived from the class's `schema.request` (`params` → `param`, `query`, `headers`, `cookies`, a JSON body → `json`, a multipart/URL-encoded body → `form`) and response types from every JSON response declared in `schema.responses`, narrowed by status code (`Date` fields are JSON-parsed to strings). Declare the property as `schema = { … } satisfies OpenAPIRouteSchema` (or build it with the new `defineRouteSchema` helper) so status keys and zod identities stay literal; a class without a schema still appears in the client with an unknown body.
  - `registerCrud(app, basePath, endpoints)` returns the app typed with the CRUD routes it registered (transcribed from each verb's generated OpenAPI schema: create 201/400, list 200 + `result_info`, read 200/404, update 200/400/404, delete 200 `{ deleted: true }`/404/409, restore, clone, upsert, search; the remaining verbs are present with an unknown body). Row types come from the endpoint's `_meta.model.schema`; create/update bodies from `meta.fields` when declared, otherwise a partial of the row. A custom `responseEnvelope` degrades outputs to `unknown`. The return value may still be ignored.
  - New `registerCrudResources(app, { [basePath]: endpoints })` registers several resources and returns one accumulated type — the statement-style `registerCrud` calls cannot accumulate across statements.
  - `defineMeta({ model, fields })` now keeps the `fields` zod type on the result (`DefinedMeta`), which is what gives create bodies a precise client type.
  - Class routes written against a custom `Env` (`class X extends OpenAPIRoute<{ Bindings: … }>`) register through the typed verb overloads on the matching app: the internal route-class constraint no longer pins `setContext` to the default `Env`.
  - `errorResponses({ 404: '…' })` is now typed by the literal statuses of its map, so `InferResponseType<…, 404>` resolves to the error envelope instead of a `number`-status entry.
  - New exported types: `SuccessEnvelope`, `PaginatedEnvelope`, `ErrorEnvelope`, `ResultInfo`, `CrudSchema`, `CrudResourcesSchema`, `CrudRow`, `CrudCreateInput`, `CrudUpdateInput`, `CrudListQuery`, `CrudReadQuery`, `CrudSearchQuery`, `RouteClassEntry`, `RouteClassSchema`, `RouteSchemaInput`, `RouteSchemaOutput`, `ToHonoPath`, `EnvelopeKindOf`, and friends.

  Hono's own verb overloads (plain handlers) are matched first and return Hono's type, so register class routes / CRUD resources before plain handlers when chaining, or keep them in separate statements.

## 0.13.29

### Patch Changes

- f1a2856: Add `defineModelsExtending` — compose `defineModels` registries acyclically across files/calls: a previously-wired base map's keys become referenceable siblings for a new map (compile-time checked across the combined keyspace), with the same auto-population, key→tableName rewrite, aggregated loud unknown-target error, and config knobs. Same-call siblings shadow base keys; base models are never re-wired, mutated, or frozen by the extending call.
- 22eedb3: Add `defineModels` — an eager model-registry factory where cross-referencing models are authored in one call and reference each other by sibling registry key. Circular graphs (User↔Post) become inert data with no declaration-ordering games; each relation's `schema`/`table` is auto-populated from its target sibling (closing the silent OpenAPI-include and drizzle-include gaps), the authored registry key is rewritten to the target's `tableName` for the adapters, and unknown targets fail fast with one aggregated setup-time error carrying a did-you-mean suggestion. Relation `model` references are compile-time constrained to the sibling keys; off-registry targets opt out per relation via `external: true`. Configurable via `DefineModelsConfig` (`autoPopulateSchema`, `autoPopulateTable`, `overwriteExplicit`, `onUnknownModel`, `freeze`).
- 052d14b: Relation-spec column-name members in `defineModels`/`defineModelsExtending` are now
  compile-checked against the direction-correct model's schema keys: `hasOne`/`hasMany`
  take `foreignKey` from the RELATED sibling's schema and `localKey` from the local
  model's; `belongsTo` flips both (the local row holds the FK); `scope.tenantField` /
  `scope.softDeleteField` always name RELATED columns. A typo'd FK column — which
  previously loaded silently-empty includes at runtime — is now a compile error at the
  authoring site. Wide (un-narrowed) schemas degrade to permissive `string`, and
  `external: true` relations keep raw strings. Authoring-surface typing only — runtime
  behavior, wired output, and `RelationConfig` are unchanged. (`RelationSpec`/`ModelSpec`
  generic parameters changed: they now take the sibling schema-map plus the authoring
  entry's key instead of a sibling key-union.)
- cfd4872: Harden `defineModels`/`defineModelsExtending` sibling lookup to own properties only: under `onUnknownModel: 'ignore'`, an unresolved relation target colliding with an `Object.prototype` member (e.g. `'constructor'`) is now left unresolved as authored instead of being wired against the prototype member.

## 0.13.28

### Patch Changes

- 49039e1: Core type-hole cleanup: `JSON.parse` results in the logging middleware are typed `unknown` instead of flowing as implicit `any`; closure-narrowing const captures remove non-null assertions in cascade collection, batch serialization, batch-upsert computed fields, and audit-log date filters; redundant `ZodObject` casts dropped in `getSchemaFields`; `successEnvelopeSchema` now returns its precise inferred type (`success: z.literal(true)`) instead of a widened cast; `createErrorHandler`'s `onHookError` first parameter is now honestly `unknown` (hooks can throw non-Errors — narrow with `instanceof Error`); new `ApiErrorCode` union gives autocomplete/typo protection on built-in error codes while `(string & {})` keeps custom codes valid (`ApiException.code`, `StructuredError.code`); `contentJson`, `createSubscribeHandler`, and `errorResponseSchema` gain explicit return types as public-boundary exports.
- c7fd4aa: Auth hardening: `verifyJWT` now validates claim shape via `safeParseJWTClaims` after signature verification — a validly-signed token with structurally malformed claims (e.g. numeric `sub`, object `roles`) is rejected with 401 `Invalid token claims` instead of being blindly cast into `JWTClaims`; this matches what `createJWTMiddleware` already did. `decodeJWT` now returns its honest unverified type `{ header: unknown; payload: JWTPayload } | null` (was falsely advertising validated `JWTClaims`) — narrow with `safeParseJWTClaims` before trusting any claim.
- 34988e1: Single-source closed unions and exhaustive lookup maps: `ActionSource`/`PendingActionStatus`, `ImportMode`/`ImportRowStatus`, and `ExportFormat` are now derived from exported `as const` tuples shared with their Zod validators (new exports: `ACTION_SOURCES`, `PENDING_ACTION_STATUSES`, `IMPORT_MODES`, `IMPORT_ROW_STATUSES`, `EXPORT_FORMATS`); the logging memory-storage sort switch and the aggregate field-restriction switch are replaced with `satisfies Record<...>` maps so adding a union member without handling it fails to compile instead of silently no-oping.
- aab028f: Schema-field authoring params are literal-checked: builder `.filter()`/`.search()`/`.sortable()`/`.defaultSort()`/`.allowedFields()`/`.blockedFields()`, functional `filterFields`/`searchFields`/`sortFields`/`allowedUpdateFields`/`blockedUpdateFields`, config-API `filtering.fields`/`search.fields`/`sorting.fields`+`default`/`update.fields.allowed|blocked`/`SearchEndpointConfig.fields`/`AggregateEndpointConfig.fields`, and the `AggregateConfig` allow-lists gain a `TField` generic for annotation-based checking (`AggregateConfig<FieldsOf<M>>`; the endpoint class field itself stays wide — property overrides get no contextual typing, so narrowing it would reject the documented `aggregateConfig = {...}` subclass pattern). All constrained params take `FieldsOf<M>` — misspelled column names fail to compile, wide metas stay permissive. Field-selection arrays deliberately stay `string[]` (they legitimately mix schema, computed, and relation names).
- c09dcc6: Typed relation names at the authoring surfaces: builder `.include()` / `.nestedCreate()` / `.nestedWrites()`, functional `allowedIncludes` / `allowNestedCreate` / `allowNestedWrites`, and config-API `includes` / `nestedCreate` / `nestedWrites` now take `RelationNamesOf<M>[]` — a typo'd relation name is a compile error when the meta was authored through `defineModel`/`defineMeta`, and degrades to permissive `string` for un-narrowed generic wrappers. Parameter positions only: nothing narrows past `.build()`, generated classes and runtime `?include=` handling (unknown names silently skipped) are byte-identical.
- 9f7433d: Model field arrays are schema-key-checked: `softDelete.field`, `multiTenant.field`, `audit.excludeFields`, `versioning.field`/`excludeFields`, `fieldEncryption.fields`, `timestamps.createdAt`/`updatedAt`, and `computedFields[*].dependsOn` now reject names that aren't keys of the model's Zod schema (each sub-config gains a defaulted `TField extends string = string` generic, so bare references and non-model uses are unchanged; `historyTable`, `contextKey`, `pathParam`, `headerName`, `queryParam` deliberately stay `string`). New `ComputedFieldReturns<C>` helper types the read-side shape computed fields add to responses. Known reuse cliff (documented in JSDoc + pinned by a type test): a variable annotated with a bare sub-config type widens to `string` and no longer assigns into a model slot — inline the object or annotate with your schema-key union; the row-typed `ComputedFieldsConfig<Row>` reuse pattern keeps compiling.
- 07544b4: Typed-relations foundation: `Model` and `MetaInput` gain a third defaulted generic `TRelations extends RelationsConfig` that preserves relation names as literal keys; `defineModel` infers it from the `relations` object (normalizing each value to the named `RelationConfig` reference so hovers and declaration emit stay flat) and `defineMeta` carries it through. New root-barrel helpers `RelationNamesOf<M>` and `FieldsOf<M>` expose the model's literal relation-name and schema-key unions for authoring surfaces; both degrade to permissive `string` on un-narrowed `MetaInput`. Backbone (endpoint classes, registrar, loaders, `NormalizedEndpointConfig`) is untouched — the default keeps every existing `Model`/`Model<T>`/`Model<T,TTable>` reference and heterogeneous collection compiling. Adds a `typecheck:types` compile-time assertion suite to the test chain.

## 0.13.27

### Patch Changes

- 60e920f: Add `DrizzleAuditLogStorage` — a durable, Drizzle-backed `AuditLogStorage` (Cloudflare D1, libsql, postgres-js, …) so audit logs survive across isolates/requests. Previously the only shipped `AuditLogStorage` was in-memory, so audit history on Workers was per-isolate and ephemeral. Ships a `sqliteAuditLogTable()` helper for D1/SQLite; one shared table backs many models (rows discriminated by the model's tableName). Semantics track `MemoryAuditLogStorage` exactly: `getAll` combines every filter (tableName, action, userId, date range) with AND, the date range is inclusive on both ends, results are oldest-first, and `limit`/`offset` slice the result. Core re-exports `AuditLogEntry`, `AuditAction`, and `AuditFieldChange` from `hono-crud/audit` so storage implementers can import them alongside the `AuditLogStorage` interface. The storage-backend contracts (`AuditLogStorage`/`AuditLogEntry`/`AuditAction`/`AuditFieldChange` and `VersioningStorage`/`VersionHistoryEntry`) are now also re-exported from `hono-crud/internal`, the curated first-party-satellite entrypoint, so `@hono-crud/*` adapters resolve them from a single internal surface instead of feature subpaths (per the Export Surface Doctrine).

## 0.13.26

### Patch Changes

- 9a621d2: refactor: single-source tag defaulting, drop dead totalPages, short-circuit batch events

  Post-pass cleanup — three internal tightenings with no change to emitted OpenAPI,
  response envelopes, or events.

  **Single-source OpenAPI tag defaulting (core).** The sugar-class factory
  (`generateEndpointClass`) no longer bakes the model-group tag default into the
  generated class's raw `schema` field. Tag defaulting (`Model.tag` ?? `tableName`,
  explicit `openapi.tags` always wins) is now applied at exactly one place — the
  emit-time choke point `resolveInstanceSchemaTags`, already used by `registerRoute`
  and `buildPerTenantOpenApi`, and now also by `toOpenApiPaths`. Registered-route
  and per-path OpenAPI emission are byte-identical. **Observable only to code
  reading a generated class's raw `.schema` field (or `getSchema()`) directly:** it
  now carries only explicitly supplied tags; the model-group default appears solely
  in emitted output. `resolveSchemaTags` is no longer re-exported from
  `hono-crud/internal` (no importer remained; the function stays in core).

  **Dead `totalPages` dropped (drizzle, prisma).** `executeDrizzleListQuery` /
  `executePrismaQuery` no longer compute or return `totalPages` on their offset
  path — every call site builds the envelope's `total_pages` via core's
  `buildOffsetPageInfo({ page, perPage, totalCount })`, so the executor value was
  unread. Response output is unchanged.

  **Batch-event no-op scheduling removed (core).** `emitBatchEvents` now resolves
  the event emitter once per request and returns immediately when none is
  configured, instead of scheduling a per-record `runAfterResponse` no-op. With an
  emitter configured the emitted events, their order, and their `runAfterResponse`
  dispatch are byte-identical (payload building moved verbatim into a shared
  `dispatchEvent`); resolution semantics match the single-verb `emitEvent`
  (per-request, never cached across requests).

## 0.13.25

### Patch Changes

- 6b602ce: Add `setAuthContext(ctx, user, authType)` to the auth subpath. This is the
  write-side counterpart to the existing auth context accessors (`getUser`,
  `getUserRoles`, `getAuthType`, …): it publishes the authenticated user id,
  user object, roles/permissions (each defaulting to `[]`), and auth type to the
  Hono context. The JWT and API-key middleware now share it instead of each
  duplicating the five `ctx.set` calls; behavior is unchanged.
- 3788ca4: fix(core): uniform plaintext for audit and version-history under field encryption

  Downstream record snapshots now carry **plaintext** for encrypted fields,
  consistent with the create/update/read verbs. Previously single delete/update/
  upsert audited the pre-mutation snapshot as **ciphertext** (the row read from
  storage was never decrypted), and the `deleted`/`updated` event `previousData`
  (what `subscribe` consumers receive) leaked ciphertext too. Audit inputs are now
  decrypted before the audit call on every verb, so `previousRecord` / `record` /
  `changes` are meaningful; the existing `audit` toggles (`storeRecord` /
  `storePreviousRecord` / `trackChanges`) remain the opt-out.

  The version-history read endpoints (`versionHistory`, `versionRead`) now decrypt
  each snapshot's `data` on return, and `versionCompare` decrypts **both** sides
  before diffing — two versions with the same plaintext but different IVs at rest
  show **no** change for that field (a raw ciphertext diff reported a spurious
  change on every write). `versionRollback` returns the historical plaintext in its
  response.

  Snapshots stay **ciphertext at rest**: the version snapshot saved on update and
  the row `versionRollback` writes back are never re-encrypted (double-encrypting a
  `{ ct, iv, v }` envelope would `String()`-cast and corrupt it) — the rolled-back
  row decrypts to the historical plaintext on the next read.

- e43a483: feat(events): emit events from all mutation verbs

  `emitEvent` previously fired only on create/update/delete/restore. Every other
  mutation verb was silent: upsert, clone, import, bulk-patch and the batch writes
  (batch-create/update/delete/restore/upsert) mutated rows without notifying any
  subscriber or webhook. They now emit at the same lifecycle position the original
  four use (right after the audit-log call, before the finalize/serialize tail,
  scheduled through `runAfterResponse`), carrying the decrypted in-memory record
  so subscribers see a uniform plaintext stream regardless of which verb wrote the
  row.

  The `CrudEventType` union (a public type, re-exported from `hono-crud/events`
  and consumed by the webhook `table:type` filter) gains nine past-tense members:
  `upserted`, `cloned`, `imported`, `bulk_patched`, and `batch_created` /
  `batch_updated` / `batch_deleted` / `batch_restored` / `batch_upserted`.

  - **Per-record fan-out.** `CrudEventPayload.recordId`/`data` are singular, so the
    batch verbs (and import / bulk-patch) emit one event PER record — exactly as
    audit fans out one entry per record via `logBatchAudit`. A new
    `emitBatchEvents` helper on the endpoint base mirrors that audit helper.
  - **Create-vs-update distinction.** `upserted` and `batch_upserted` carry
    `metadata.created`; `imported` carries `metadata.status` (`created`/`updated`).
  - **Delete snapshots.** `deleted` / `batch_deleted` carry the record under
    `previousData`.
  - **bulk-patch** emits only when the adapter surfaces the patched rows (the
    singular `recordId` payload cannot represent a count-only UPDATE).

- a7ca1bf: fix(core): apply field encryption across all write/read verbs

  `fieldEncryption` previously only encrypted on create/update and decrypted on
  read/list. Every other verb leaked: upsert, clone, import, bulk-patch and the
  batch writes (batch-create/update/upsert) persisted **plaintext** for encrypted
  fields, and search, export, restore and the batch reads (batch-delete/restore)
  returned **ciphertext**. Encryption is now applied at the same lifecycle
  position (after the before-hook, before the adapter write) and decryption after
  the adapter read (before the after-hook/response) on the full verb surface, so
  a round trip is transparent regardless of which verb wrote or read the row.

  `aggregate` is intentionally exempt: non-deterministic encryption makes grouping
  and MIN/MAX over an encrypted field meaningless, and numeric aggregations never
  expose the plaintext.

  Note: on SQL adapters an encrypted column must be a JSON column (Drizzle
  `text(name, { mode: 'json' })` / Prisma `Json`) to hold the `{ ct, iv, v }`
  envelope — a plain text/String column cannot.

- 1f1f9b5: Add `createMemoryCrud(meta)` — the in-memory sibling of `createDrizzleCrud`/`createPrismaCrud`. It returns CRUD endpoint base classes with `_meta` pre-stamped (memory has no `db` to bind), so class-based endpoints drop the per-class `_meta` restatement.

  OpenAPI `tags` now default from the model's `tag` (falling back to `tableName`) for **every** endpoint definition style — the sugar path (`defineEndpoints`/builder/functional), the adapter CRUD factories (`createMemoryCrud`/`createDrizzleCrud`/`createPrismaCrud`), and plain hand-written class-based endpoints. Defaulting happens once, at route registration, so declaring `tag` on the model (`defineModel({ tableName: 'users', tag: 'Users', ... })`) sets a capitalized display group that every surface honors — the live `/openapi.json`, `buildPerTenantOpenApi`, and `toOpenApiPaths` — without repeating `tags` on each endpoint. An explicit non-empty `schema.tags` always wins, so existing explicitly-tagged endpoints are byte-identical.

## 0.13.24

### Patch Changes

- 3cb6910: Fix a cross-tenant data leak in the version endpoints. `versionHistory`,
  `versionRead`, `versionCompare`, and `versionRollback` did not apply the model's
  `multiTenant` owner-scope, so any authenticated user who knew a record id could
  read (or roll back) another tenant's version history — while the base CRUD reads
  correctly 404'd. All four endpoints now gate on a tenant-scoped `recordExists`
  (the parent record must exist AND belong to the caller's tenant), matching base
  reads; owning the record implies owning its versions since record ids are
  unique. New `CrudEndpoint#getTenantScope()` helper; the Drizzle and Memory
  adapters scope their existence check by the tenant field.

## 0.13.23

### Patch Changes

- e0eac64: Add `DrizzleVersioningStorage` — a durable, Drizzle-backed `VersioningStorage` (Cloudflare D1, libsql, postgres-js, …) so record version history survives across isolates/requests. Previously the only shipped `VersioningStorage` was in-memory, so version history on Workers was per-isolate and ephemeral. Ships a `sqliteVersionHistoryTable()` helper for D1/SQLite; one shared table backs many models (rows discriminated by the model's tableName). Core re-exports `VersionHistoryEntry` from `hono-crud/versioning` so storage implementers can import it alongside `VersioningStorage`.

## 0.13.22

### Patch Changes

- e7ecacf: feat(config): config-API response caching with invalidation

  `endpoints.{list,read}.cache` enables response caching (X-Cache MISS→HIT) and
  `endpoints.{create,update,delete}.cache.invalidate` busts it — all through the
  config API, no subclassing. Core now owns the cache code path (key format,
  `CacheConfig`, the cache-storage feature); `@hono-crud/cache` re-exports the
  storage feature so the `withCache` mixin and the config path share ONE storage
  global.

  Cache keys are tenant-scoped automatically on multiTenant resources, so a
  cached page is never served across tenants; invalidation uses the same
  tenant-scoped prefix. Storage resolves from request context
  (`createCacheStorageMiddleware`) or the global `setCacheStorage`.

## 0.13.21

### Patch Changes

- c0f0057: feat(config): expose keyset (cursor) pagination through the list config API

  `ListEndpointConfig.pagination` now accepts `cursor: { enabled, field }`, so
  config-based consumers can opt into keyset pagination without subclassing an
  endpoint. `defineEndpoints` forwards it to the generated endpoint as
  `cursorPaginationEnabled` / `cursorField`. `supportsCursorPagination` stays
  adapter-owned, so enabling cursor on an adapter without keyset support still
  throws the loud `ConfigurationException` (no silent fallback to offset). Default
  cursor field is `id`.

## 0.13.20

### Patch Changes

- 855fe4a: Make framework-bridge (e.g. @velajs/crud) CRUD resources MCP-discoverable, and fix `tools/list` for schemas with date fields.

  - `hono-crud/internal` now exports `recordCrudResource`, so a bridge that mounts generated CRUD routes via a sub-app can also record the resource on the parent app — where `getRegisteredCrudResources(app)` (and `@hono-crud/mcp`'s `auto` discovery) read it. Previously such resources were recorded only on the isolated sub-app and were invisible to MCP.
  - `@hono-crud/mcp`: `buildInputShape` now coerces tool-input fields the MCP SDK cannot represent in JSON Schema (e.g. `z.date()`) to a representable string, preserving optionality, instead of letting the SDK's `toJSONSchema` throw and break the entire `tools/list`. (Query/body dates arrive as strings on the wire anyway, so endpoints still parse them.)

## 0.13.19

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

## 0.13.18

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

## 0.13.17

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

## 0.13.16

### Patch Changes

- fa184db: OpenAPI: document `?include=` relations in List/Read responses.

  When a List/Read endpoint has `allowedIncludes` and an included relation declares
  a `schema` (the related model's shape), that relation is now added to the response
  **item** schema as an OPTIONAL field — `hasMany` → array, `belongsTo`/`hasOne` →
  nullable object. Previously a relation's `schema` was used only for internal
  response typing and never reached the generated OpenAPI document, so consumers of
  generated typed clients had to hand-type the embedded relation.

  Backward-compatible and opt-in: relations without a `schema` (or endpoints without
  `allowedIncludes`) are unchanged. Adds the internal helper `withIncludableRelations`.

## 0.13.15

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

## 0.13.14

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

- a50d497: Core structure consolidation (internal — public import surface unchanged except three dead exports):

  - One canonical CRUD route table (`CRUD_ROUTES`, exported via `hono-crud/internal`): all 22 endpoint slots as ordered `[name, verb, subPath]` rows with the registration-order invariants documented in one place. `registerCrud`'s 125-line if-chain is now a loop over it; the OpenAPI paths emitter's private duplicate table is gone; `CrudEndpointName` is derived from the table so it can never drift.
  - Health is now a core subpath: `hono-crud/health` replaces the retired `@hono-crud/health` package (same API; zero deps and zero core coupling made a separate package pure overhead).
  - New `hono-crud/cloudflare` module home (merges the former `types/` and `shared/` single-file directories).
  - "Phase E" finished: auth context accessors live in `auth/context.ts` (also exported from `hono-crud/auth`), the back-compat shim `core/context-helpers.ts` is gone, and context reads use `CONTEXT_KEYS` constants instead of string literals.
  - One canonical helper each: `getClientIp` (the `trustProxy` knob is now honored, library-wide default `true` — edge-first; logging middleware previously discarded `trustProxy: false`), one `PathPattern` (auth/logging/rate-limit re-export it), logging's pure delegation shims deleted.
  - Removed dead exports: `createNullableRegistry`, `createRegistryWithDefault`, `PerTenantOpenApiConfig` (use `OpenAPIConfig`).

- e121270: Docs truth sweep — every shipped code sample now typechecks against the real API, plus the type-level fixes that pass surfaced:

  - `withCache` / `withCacheInvalidation` / `withAuth` now accept abstract base classes and return an extendable constructor type. The documented `class X extends withCache(MemoryReadEndpoint)` pattern previously failed to compile for consumers (adapter endpoint classes are abstract, and the old `TBase & Constructor<...>` return type could not be extended — TS2510). Behavior unchanged; types only (`AbstractConstructor` is exported from `hono-crud/internal`).
  - `PendingActionSchema` is now exported from `hono-crud/auth` — its JSDoc already directed storage-adapter authors to validate rows with it, but it was never re-exported.
  - `PrismaClient` (the structural client constraint) is now exported from `@hono-crud/prisma` so consumers can name the type that `prisma = ...` and `createPrismaCrud(...)` accept.
  - Corrected shipped JSDoc: the `withCache` and `AuthenticatedEndpoint` examples no longer show a `handle(ctx)` override (the registrar injects context; `handle()` is parameterless), and the lifecycle-hook docs no longer claim `fire-and-forget` is the default `afterHookMode` (the default is `sequential`).

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

- fd3895f: Cursor pagination is now real on all three adapters. Previously core advertised cursor query params and `next_cursor`/`prev_cursor` response fields, but only the memory adapter implemented them — Drizzle and Prisma silently fell back to offset pagination.

  - **Drizzle**: keyset via `WHERE cursorField > decoded ORDER BY cursorField LIMIT n+1`; **Prisma**: native `cursor` + `skip: 1` + `take: n+1`. All three adapters build the cursor-mode `result_info` envelope through one shared core helper, so the shape is byte-identical.
  - **`prev_cursor` removed** (breaking): cursor walks are next-only (Stripe-style) — SQL keyset "previous" requires a reversed query and was only ever implemented in memory.
  - **`order_by` is forced to the cursor field during cursor walks** (documented on the query param) — previously the three adapters could diverge on sort semantics mid-walk.
  - **No silent degradation**: cursor query params and `next_cursor` only appear in the OpenAPI schema when the endpoint enables cursor pagination AND the adapter supports it; enabling it on an unsupporting adapter throws `ConfigurationException` instead of quietly serving offset pages.
  - List-query logic deduplicated per adapter (`executeDrizzleListQuery` / memory store query helper, mirroring Prisma's existing `executePrismaQuery`) and batch OpenAPI scaffolding shared by the three id-keyed batch verbs.

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

## 0.13.13

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

## 0.13.12

### Patch Changes

- 1b4c5dd: Error-shape unification (breaking, patch): every failure the library emits now uses the one canonical envelope `{ success: false, error: { code, message, details? } }` with a stable machine-readable code, and the OpenAPI docs tell the same story as the wire.

  - Validation is one shape on one status: `openApiValidationHook` now throws `InputValidationException` instead of returning a 422 ZodError-style body, so the hook path and the thrown path produce the identical 400 `VALIDATION_ERROR` envelope with `details: [{path, message, code}]`. `createValidationHook`'s default status flips 422 → 400 (explicit 422 still accepted). `fromHono` installs the canonical hook as `defaultHook` when none is set, so bare apps stop leaking `@hono/zod-validator`'s raw ZodError body.
  - Library throw-sites get real codes instead of generic `HTTP_ERROR`: write-policy denial → 403 `FORBIDDEN` (as its docblock always claimed), missing tenant → 400 `TENANT_REQUIRED` (endpoint and middleware paths), failed tenant validation → 400 `INVALID_TENANT`. Aggregate allow-list/limit denials change from 500 `INTERNAL_ERROR` to 400 `AGGREGATION_ERROR`; search min-query and subscribe failures now throw typed exceptions (same codes/statuses) so custom response envelopes apply.
  - Doc truthfulness: list and export endpoints now declare the 400 response their failable query schemas can produce; bulk-patch's hand-written 400 body is replaced with the canonical schema; new `validationIssueSchema` describes the `details` items.
  - Hardening: `ApiException.getResponse()` returns the canonical JSON envelope, so apps without `createErrorHandler` no longer get Hono's plain-text fallback; falsy `details` values (0, '', false) are no longer dropped.
  - Removed orphan exports (never emitted by anything): `successResponse`, `errorResponse`, `HttpErrorSchema`, `ZodErrorSchema`, `ZodIssueSchema`, `createErrorSchema`, `createOneOfErrorSchema`, `httpErrorContent`, `commonResponses`, `ValidationHookResult` — use `errorResponseSchema` / `errorResponses` / `validationIssueSchema` / the canonical envelope schemas instead.

## 0.13.11

### Patch Changes

- 97e92f5: Dedup batch: the edge-safe in-memory TTL machinery, the cache entry wire format, and the relation-batching control flow each now live in exactly one place.

  - New internal `MemoryTtlStore` in core (exported via `hono-crud/internal`) owns lazy cleanup-on-access, expiry-on-read, and insertion-order capacity eviction. The cache, rate-limit, and idempotency memory storages compose it, supplying only their entry shapes and domain indices (cache tag index via an eviction hook, idempotency locks as a second store). Public constructor options are unchanged. The logging memory storage intentionally stays standalone — its newest-first ordering is a different structure, not drift.
  - New cache entry codec (`packages/cache/src/entry.ts`, internal): `buildCacheEntry` / `normalizeStoredEntry` / `isCacheEntryExpired` shared by the memory, Redis, and Cloudflare KV backends — including the single canonical legacy-Date migration guard, so already-persisted entries keep reading identically.
  - New relation-batching orchestrator in core (exported via `hono-crud/internal`): the ORM-agnostic control flow (key collection, grouping, map-back, lookup-map dispatch over hasOne/hasMany/belongsTo) is shared; drizzle, prisma, and memory supply only their query adapters. N+1 batching fixes now land in one place.
  - Two deliberate behavior fixes that the dedup surfaced: (1) single-item relation reads in the memory and drizzle adapters now always set the relation key (`null` / `[]` instead of absent), matching the batch path and prisma — this also fixes memory's belongsTo gating on the row's own `id` instead of the foreign key; (2) the rate-limit fixed window no longer slides its stored expiry on within-window increments — the window keeps its original `windowStart + windowMs` end.
  - Internal-only removals (never publicly exported): memory's `loadRelation`, prisma's `loadPrismaRelation`.

## 0.13.10

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
