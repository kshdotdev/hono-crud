---
'hono-crud': patch
---

Declare `registerCrud` base-path params in the OpenAPI document. `registerCrud(app, '/notes/:noteId/comments', …)` emitted `/notes/{noteId}/comments` with no `noteId` parameter, which the OpenAPI spec forbids (every `{param}` in a path must be declared). Each base-path param is now a required string path param on every route (optional `:param?` segments excepted, since requests may omit them), in the live, per-tenant and `toOpenApiPaths` documents; a params schema you declare for the same name wins. `toOpenApiPaths` now also emits a Hono-style `basePath` (`/notes/:noteId/comments`) in OpenAPI form (`/notes/{noteId}/comments`), so the declared params match the path.
