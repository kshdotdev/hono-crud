---
"hono-crud": patch
---

`registerCrud(...)` now records each resource on the app instance (app-scoped, startup-time, edge-safe), and `hono-crud/internal` exports `getRegisteredCrudResources(app)` plus the `RegisteredCrudResource` type. This lets addon packages (e.g. `@hono-crud/mcp`) enumerate registered CRUD resources. No behavior change for existing apps.
