---
'hono-crud': minor
---

The cursor-pagination `limit` param is declared as an integer from 1 up to `maxPerPage`, stated in the OpenAPI document and enforced on the request. It used to be an optional string, clamped at runtime. A `limit` outside that range, including an empty `?limit=`, answers 400 `VALIDATION_ERROR`. It has no default: a present `limit` is what starts a cursor walk.
