# hono-crud Development Rules

## TypeScript Rules

### NEVER use `any` type
- Use `unknown` for values of unknown type
- Create proper interfaces for known structures
- Use type assertions with `as unknown as TargetType` when casting is necessary
- Prefer generics over `any` for flexible typing

### Drizzle Adapter Pattern
The Drizzle adapter uses a two-tier type system (packages/drizzle/src/helpers.ts):
1. **Public constraint** (`DrizzleDatabaseConstraint`): structural bound with `unknown` members
   (`select`/`insert`/`update`/`delete`/`transaction`), used as the `DB` generic bound on every
   endpoint class — any Drizzle database satisfies it without coupling to drizzle-orm types.
2. **Internal interfaces** (`Database<Row>`, `QueryBuilder<Row>`): typed method signatures used
   inside the adapter; `Row` derives from the consumer's Zod schema (`ModelObject<M['model']>`),
   never from a drizzle-orm type. `QueryBuilder<Row>` is `PromiseLike<Row[]>`.
3. **Casting function** (`cast<Row>()`): the single sanctioned boundary `as`, converting an
   unknown database instance to `Database<Row>` for internal method calls.
This pattern avoids coupling to specific Drizzle versions while maintaining internal type safety.

## Naming Doctrine

1. `create<Feature>Middleware()` — app.use-style cross-cutting middleware factories.
   **Documented exceptions (rename only with owner sign-off):** `multiTenant()`, `apiVersion()`,
   and `apiVersionedResponse()` keep their feature-named forms. Each anchors a feature family
   whose entire public surface shares the feature prefix (`apiVersion`/`getApiVersion`/
   `getApiVersionConfig`/`ApiVersionEnv`/`CONTEXT_KEYS.apiVersion`; `multiTenant`/
   `MultiTenantConfig`/`MultiTenantMiddlewareConfig`/`TenantEnv`), so a `create<Feature>Middleware`
   spelling would break family symmetry for zero disambiguation gain. The old bare-noun
   `idempotency` factory was renamed because its name collided with its package name and it
   anchored no such accessor family.
2. `with<Feature>()` — class mixins only.
3. `<vendor>UI()` / `docsIndex()` — GET-mounted documentation-page factories returning
   `MiddlewareHandler` (sanctioned family modeled on `scalarUI`; they are page handlers, not
   cross-cutting middleware, hence not `create*Middleware`). **Family field vocabulary
   (ScalarConfig is the source):** `specUrl` = location of the OpenAPI spec the page loads;
   `pageTitle` = the HTML `<title>`; `<sibling>Path` (`docsPath`/`redocPath`/`scalarPath`) =
   href of a sibling docs page rendered as a link.
4. `create<Feature>Routes()` — router factories returning a mountable `Hono` when a feature
   genuinely owns multiple routes (health).
5. `*Config` = top-level setup bag of a middleware/factory; `*Options` = per-operation/per-call
   leaf bag (and storage-adapter constructor bags).

### Config vs Options naming
- `*Config` — the top-level bag a middleware factory, route/router factory, or feature factory
  accepts once at setup time (RateLimitConfig, IdempotencyConfig, HealthConfig, ScalarConfig,
  ApiVersioningConfig, MultiTenantMiddlewareConfig, CrudMcpConfig, SwaggerUIConfig).
- `*Options` — a leaf bag scoped to a single operation/call or sub-feature (ListOptions,
  SearchOptions, ExportOptions, CacheSetOptions, ToolOptions, ResourceOptions), and
  storage-adapter constructor bags (KVRateLimitStorageOptions).
- Documented exceptions (legacy, rename only with owner sign-off): RouterOptions,
  RegisterCrudOptions, CreateDrizzleCrudOptions, PerTenantOpenApiOptions.

## Edge Runtime Compatibility

This library targets edge runtimes (Cloudflare Workers, Deno, Bun). All library source code in `src/` must be edge-safe.

### Banned Node.js APIs (never use in library source code)
- `fs`, `path`, `os`, `child_process`, `net`, `http`, `https`, `dgram`, `cluster`, `worker_threads`, `vm`, `tls`, `dns`, `readline`
- `crypto` from Node.js — use Web Crypto API (`crypto.subtle`, `crypto.getRandomValues()`) instead
- `createRequire` / `require()` from `'module'`
- `Buffer` — use `Uint8Array` + `TextEncoder`/`TextDecoder`
- `process` — use Hono's `env()` from `hono/adapter` for env vars
- `__dirname`, `__filename`
- `setInterval` — not available in all edge runtimes
- `global`/`globalThis` for mutable state — use Hono context or request-scoped storage
- Any `node:*` prefixed imports

### Required Web Standard alternatives
| Instead of | Use |
|---|---|
| Node.js `crypto` | `crypto.subtle` / `crypto.getRandomValues()` |
| `Buffer` | `Uint8Array` / `ArrayBuffer` |
| `TextEncoder`/`TextDecoder` | Already Web Standard (keep using) |
| `process.env` | `env()` from `hono/adapter` |
| `require()` | Dynamic `import()` |
| Node.js `fetch` | Global `fetch` (Web Standard) |

### Dependency rules
- Every new dependency must be edge-compatible (no Node.js-only packages)
- Prefer packages that explicitly support Cloudflare Workers / edge runtimes
- Never add `node:*` prefixed imports

### Code patterns
- Use dynamic `import()` for optional dependencies — never `require()` or `createRequire`
- No `eval()` or `new Function()`
- Keep cold-start cost low: lazy-load heavy optional modules, avoid top-level side effects
- Examples (`examples/`) may use Node.js APIs since they're not shipped as library code
