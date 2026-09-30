---
'hono-crud': minor
---

Search `page` and `per_page` get the same declaration as list: integers from 1, `page` defaulting to 1, `per_page` defaulting to the search endpoint's `defaultPerPage` and capped at its `maxPerPage`, stated in the OpenAPI document and enforced on the request. A value outside that range answers 400 `VALIDATION_ERROR` instead of being clamped, including an empty value such as `?per_page=`.
