---
"hono-crud": patch
"@hono-crud/memory": patch
"@hono-crud/mcp": patch
---

BREAKING: export-surface rewrite — the root barrel owns only the CRUD core; every feature family is importable only from its subpath.

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
