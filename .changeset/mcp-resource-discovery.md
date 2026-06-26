---
"hono-crud": patch
"@hono-crud/mcp": patch
---

Make framework-bridge (e.g. @velajs/crud) CRUD resources MCP-discoverable, and fix `tools/list` for schemas with date fields.

- `hono-crud/internal` now exports `recordCrudResource`, so a bridge that mounts generated CRUD routes via a sub-app can also record the resource on the parent app — where `getRegisteredCrudResources(app)` (and `@hono-crud/mcp`'s `auto` discovery) read it. Previously such resources were recorded only on the isolated sub-app and were invisible to MCP.
- `@hono-crud/mcp`: `buildInputShape` now coerces tool-input fields the MCP SDK cannot represent in JSON Schema (e.g. `z.date()`) to a representable string, preserving optionality, instead of letting the SDK's `toJSONSchema` throw and break the entire `tools/list`. (Query/body dates arrive as strings on the wire anyway, so endpoints still parse them.)
