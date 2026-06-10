# @hono-crud/cache

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

- dd62008: Cache HITs now honor the configured `ResponseEnvelope`. The cache mixin previously hardcoded the default `{success, result}` envelope when serving from cache, so endpoints with a custom envelope returned different body shapes on HIT vs MISS. Raw result data is now cached and the envelope is applied at response time through the same path as uncached responses; `X-Cache` headers are unchanged.
- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- Updated dependencies [dd62008]
  - hono-crud@0.13.9

## 0.1.5

### Patch Changes

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
