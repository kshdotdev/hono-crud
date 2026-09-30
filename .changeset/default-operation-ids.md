---
'hono-crud': minor
---

Give every `registerCrud` route a default OpenAPI `operationId` (#151).

Ids are `<verb><Resource>`, derived from the endpoint slot and the registered path: `/comments` gets `listComments`, `createComment`, `getComment`, `updateComment` and `deleteComment`, and `/notes/:noteId/comments` gets `listNoteComments`. Client generators use these as function names instead of building them from method and path (`getApiNotesByIdComments`). An explicit `schema.operationId` still wins, and a generated id that duplicates another one in the same app fails at setup.

**Upgrading:** if you generate a client from the spec today, its function names change on regeneration. Pass `fromHono(app, { operationIds: false })` to emit no default ids and keep the previous function names.
