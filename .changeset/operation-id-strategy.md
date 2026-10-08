---
'hono-crud': patch
---

`operationIds` on `fromHono` and `toOpenApiPaths` also accepts a naming function (#151). It receives `{ operation, method, path, basePath, model, defaultId }` and returns the `operationId` to emit, or `undefined` for none — e.g. prefix ids for an app mounted at `/v2` so they don't clash with `/v1`. An explicit `schema.operationId` still wins, and on `fromHono` a duplicate still fails at setup (`toOpenApiPaths` emits what the function returns). The context type is exported as `OperationIdContext`.
