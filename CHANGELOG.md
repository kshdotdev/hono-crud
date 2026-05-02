# Changelog

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
%b
%b
%b
## [0.7.0] - 2026-05-02

### Added

- `requireApproval(config)` middleware — human-in-the-loop deferred
  execution. First call writes a `PendingAction` to pluggable storage and
  returns `202 { status: 'pending', actionId, expiresAt }`. A second call
  with the action's `_resume_<id>` field in the body, after approval,
  replays the original input into the handler.
- `MemoryApprovalStorage` — reference `ApprovalStorage` implementation
  with lazy expiry on `get()` (no `setInterval` — edge-safe).
- `PendingAction` carries full actor identity (`actorUserId`,
  `onBehalfOfUserId`, `agentId`, `agentRunId`, `toolCallId`, `source`)
  pulled from `c.var` so audit logs distinguish human vs. agent vs.
  agent-on-behalf-of-user.
- `parseIso8601Duration(input)` — small Web-safe parser for the
  `P[nD][T[nH][nM][nS]]` subset, used by `requireApproval`'s
  `expiresAfter`.
- `requirePolicy(policies)` middleware + `Model.policies` (`ModelPolicies<T>`).
  Row-level (`read`/`write` predicates), field-level (`fields` masker),
  and optional SQL-pushdown (`readPushdown` returning `FilterCondition[]`)
  applied automatically by List, Read, Update, and Delete endpoints.
- `HookContext` — passed to `before`/`after` lifecycle hooks. Carries
  `db.tx` (the in-flight transaction handle), `request`, and request-scoped
  identifiers (`tenantId`, `organizationId`, `userId`, `agentId`,
  `agentRunId`).
- `MEMORY_NOOP_TX` sentinel exposed on `HookContext.db.tx` for memory-
  adapter writes; downstream code can feature-detect to know rollback is
  not available.

### Changed

- Hooks `before(data, _tx?)` / `after(data, _tx?)` on Create / Update /
  Delete now receive a `HookContext` as the second argument instead of a
  bare tx handle. Existing overrides typed as `(data, _tx?: unknown)`
  remain compile-compatible — the second param is widened to `HookContext`.
  When `useTransaction === true` (Drizzle adapter) AND `afterHookMode ===
  'sequential'` (the default), throwing in an `after*` hook rolls back the
  parent INSERT / UPDATE / DELETE — enables event-outbox patterns where
  hook-emitted side effects must rollback alongside the parent write.
- `CrudEventPayload` adds optional `tenantId` and `organizationId`. The
  emitter populates both from the conventional `c.var` slots so subscribers
  can fan out per-tenant without re-deriving identity from the record body.

[0.7.0]: https://github.com/kshdotdev/hono-crud/compare/v0.6.0...v0.7.0

## [0.6.0] - 2026-05-02

### Added

- `Model.resolveSchema(ctx)` hook — optional async resolver for per-tenant
  (or per-request) Zod schema overrides. The static `Model.schema` remains
  required and acts as the fallback when no resolver is configured.
- `SchemaResolveContext` — `{ tenantId, organizationId, request, env, cacheKey }`
  passed to the resolver. Tenant/org are read from the conventional Hono
  context vars (`c.var.tenantId`, `c.var.organizationId`) so the resolver
  works whether the model opts into `multiTenant` or not.
- `buildPerTenantOpenApi(app, ctx, options?)` — re-emits the OpenAPI document
  for a specific tenant, awaiting every model's resolver so request and
  response shapes reflect per-tenant fields. Optional `cache` (any
  `{ get, set }` shape) keys per-tenant docs at `openapi:{tenantId}:{version}`
  with a default 60s TTL.
- `wrapCacheStorageForOpenApi(storage)` — adapter that bridges the lib's
  `CacheStorage` (Memory / KV / Redis implementations) to the loose
  `PerTenantOpenApiCache` shape.
- `getHandlerForApp(app)` and `RegisteredRoute` exports for advanced
  integrations that need to walk a `fromHono(...)` app's route registry.

### Changed

- `OpenAPIRoute.getValidatedData()` (via `CrudEndpoint`) now resolves the
  per-tenant schema (if configured) and re-validates request bodies against
  the resolved schema. The resolver runs at most once per request — results
  are memoized on the Hono context. Endpoints with no resolver behave
  identically to 0.5.x.
- Schema-emission paths in every CRUD endpoint route through a new
  `getModelSchema()` accessor instead of reading `_meta.model.schema`
  directly, so per-tenant schemas surface in body validation, OpenAPI
  emission, and field-selection enumeration without per-endpoint changes.

[0.6.0]: https://github.com/kshdotdev/hono-crud/compare/v0.5.3...v0.6.0

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
