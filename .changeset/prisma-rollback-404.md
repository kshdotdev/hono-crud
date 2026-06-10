---
"@hono-crud/prisma": patch
---

Version rollback now returns 404 `NOT_FOUND` when the target record no longer exists, honoring the endpoint's declared OpenAPI contract. Previously the adapter threw a plain `Error`, which surfaced as 500 `INTERNAL_ERROR`.
