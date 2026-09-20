---
'hono-crud': patch
---

`OpenAPIRoute.getValidatedData()` now returns `multipart/form-data` and `application/x-www-form-urlencoded` bodies. zod-openapi validates those under the `form` target rather than `json`, so `data.body` used to come back `undefined` for every upload endpoint; the validated form value is now read, and the raw fallback parses the body with `parseBody()` when the schema declares a form media type.
