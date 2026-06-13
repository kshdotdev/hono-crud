---
'hono-crud': patch
'@hono-crud/cache': patch
'@hono-crud/rate-limit': patch
'@hono-crud/idempotency': patch
'@hono-crud/mcp': patch
---

Naming & config-shape unification (breaking renames, no aliases).

**Model feature enablement idiom.** `Model.audit` and `Model.versioning` are now `boolean | Config` like their `softDelete`/`multiTenant` siblings; the required `enabled` field is removed from `AuditConfig` and `VersioningConfig`. Write `audit: true` / `versioning: true` (or a config object — presence enables); `getAuditConfig`/`getVersioningConfig` and the `AuditLogger`/`VersionManager`/`createAuditLogger`/`createVersionManager` config params accept the union. `NormalizedAuditConfig`/`NormalizedVersioningConfig` still carry `enabled`. `fieldEncryption` stays presence-enabled (it has required members).

**Path-filter and message vocabulary.** `excludePaths` is the one name for "paths this middleware bypasses": `AuthConfig.skipPaths` → `excludePaths`, `RateLimitConfig.skipPaths` → `excludePaths`, and mcp `AutoOptions.include`/`exclude` → `includePaths`/`excludePaths` (they match `registerCrud` mount paths with the same shared matcher). `AuthConfig.unauthorizedMessage` → `errorMessage`, matching rate-limit and multiTenant.

**Duration unit suffixes (renames only — no field changed its unit).**

| Old | New | Unit |
| --- | --- | --- |
| `CacheConfig.ttl` | `ttlSeconds` | seconds |
| `IdempotencyConfig.ttl` | `ttlSeconds` | seconds |
| `IdempotencyConfig.lockTimeout` | `lockTimeoutSeconds` | seconds |
| `JWTConfig.clockTolerance` / `JWTClaimsValidationOptions.clockTolerance` | `clockToleranceSeconds` | seconds |
| `SubscribeEndpointConfig.heartbeatInterval` | `heartbeatIntervalMs` | ms |
| `SubscribeEndpointConfig.connectionTimeout` | `connectionTimeoutMs` | ms |
| `HealthCheck.timeout` | `timeoutMs` | ms |
| `HealthConfig.defaultTimeout` | `defaultTimeoutMs` | ms |
| `WebhookEndpoint.timeout` | `timeoutMs` | ms |
| `MemoryTtlStoreOptions.cleanupInterval` | `cleanupIntervalMs` | ms |
| `MemoryLoggingStorageOptions.maxAge` / `.cleanupInterval` | `maxAgeMs` / `cleanupIntervalMs` | ms |
| `MemoryIdempotencyStorageOptions.cleanupInterval` | `cleanupIntervalMs` | ms |
| `MemoryRateLimitStorageOptions.cleanupInterval` | `cleanupIntervalMs` | ms |

Documented exception: `RateLimitResult.retryAfter` keeps its name (mirrors the HTTP Retry-After header, seconds by RFC).

**Env types.** `TenantEnv` now types its tenant variable optional (`string | undefined` until the middleware runs), matching every other `*Env`. `HonoCrudEnv` now folds in `TenantEnv & ApiVersionEnv`, making its "all core context variables" claim true.

**Rate-limit extractor nullability.** `extractUserId` and `extractAPIKey` return `string | undefined` (was `string | null`); `KeyExtractor` is `(ctx) => string | undefined` — custom extractors returning `null` must return `undefined`. `extractIP` keeps its `'unknown'` fail-closed sentinel: a falsy key would skip rate limiting entirely, and limits must not fail open when no IP is derivable.
