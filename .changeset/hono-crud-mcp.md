---
"@hono-crud/mcp": patch
---

Add `@hono-crud/mcp`: auto-generate Model Context Protocol (MCP) tools from hono-crud resources. Introspects the CRUD endpoints you register and exposes `list`/`read`/`create`/`update`/`delete` as MCP tools over HTTP streaming transport, re-dispatching tool calls through the mounted Hono app so they share the full REST pipeline (auth, validation, hooks, serialization, pagination). Register resources explicitly with `mcp.resource(path, endpoints)`, or set `auto: true` to discover and expose every `registerCrud(...)` resource automatically (with include/exclude, default operations, and per-resource overrides). Configurable tool names, descriptions, operation allow-list, and MCP annotations; pluggable bearer-token auth by default with optional MCP OAuth 2.1.
