---
'hono-crud': minor
---

`toOpenApiPaths` emits the same default `operationId`s as `registerCrud` (#151): derived from `basePath` when given (`/comments` → `listComments`, `getComment`, ...), otherwise from the model's `tableName`. Pass `operationIds: false` to omit them.
