---
"hono-crud": patch
"@hono-crud/rate-limit": patch
"@hono-crud/mcp": patch
---

Core structure consolidation (internal — public import surface unchanged except three dead exports):

- One canonical CRUD route table (`CRUD_ROUTES`, exported via `hono-crud/internal`): all 22 endpoint slots as ordered `[name, verb, subPath]` rows with the registration-order invariants documented in one place. `registerCrud`'s 125-line if-chain is now a loop over it; the OpenAPI paths emitter's private duplicate table is gone; `CrudEndpointName` is derived from the table so it can never drift.
- Health is now a core subpath: `hono-crud/health` replaces the retired `@hono-crud/health` package (same API; zero deps and zero core coupling made a separate package pure overhead).
- New `hono-crud/cloudflare` module home (merges the former `types/` and `shared/` single-file directories).
- "Phase E" finished: auth context accessors live in `auth/context.ts` (also exported from `hono-crud/auth`), the back-compat shim `core/context-helpers.ts` is gone, and context reads use `CONTEXT_KEYS` constants instead of string literals.
- One canonical helper each: `getClientIp` (the `trustProxy` knob is now honored, library-wide default `true` — edge-first; logging middleware previously discarded `trustProxy: false`), one `PathPattern` (auth/logging/rate-limit re-export it), logging's pure delegation shims deleted.
- Removed dead exports: `createNullableRegistry`, `createRegistryWithDefault`, `PerTenantOpenApiConfig` (use `OpenAPIConfig`).
