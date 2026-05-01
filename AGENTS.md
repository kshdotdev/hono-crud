# hono-crud Development Rules

## TypeScript Rules

### NEVER use `any` type
- Use `unknown` for values of unknown type
- Create proper interfaces for known structures
- Use type assertions with `as unknown as TargetType` when casting is necessary
- Prefer generics over `any` for flexible typing

### Drizzle Adapter Pattern
The Drizzle adapter uses a two-tier type system:
1. **Public interface** (`DrizzleDatabase`): Uses `unknown` returns to accept any Drizzle database
2. **Internal interface** (`InternalDatabase`, `InternalQueryBuilder`): Uses specific method signatures
3. **Casting function** (`toInternal()`): Safely converts public to internal type for method calls

This pattern avoids coupling to specific Drizzle versions while maintaining internal type safety.

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
