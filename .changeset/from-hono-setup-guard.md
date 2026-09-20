---
'hono-crud': patch
---

`fromHono()` now fails loudly at setup time when handed a plain `Hono` that already carries registrations (`.use()` middleware or routes) instead of silently discarding them — a plain `Hono` cannot be adopted, so construct the app with `new OpenAPIHono<Env>()` (the plain-`Hono` form is deprecated). The proxy also keeps chaining: a plain handler registration (`app.get(path, handler)`) now returns the proxy, so a following `.get(path, RouteClass)` in the same chain goes through class-route registration. The Drizzle + D1 example was rebuilt on `OpenAPIHono` so its per-request `db` injection and KV response cache actually run, and its stale "`ilike` is unsupported on SQLite" note was removed (it is implemented with `INSTR(LOWER(...))`).
