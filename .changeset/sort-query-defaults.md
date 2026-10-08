---
'hono-crud': patch
---

List and search `sort` / `order` query params state their defaults in the OpenAPI document: `order` defaults to `defaultSort.order` (else `asc`), and `sort` to `defaultSort.field` when that field is one of `sortFields`. A generated client reads the default ordering instead of restating it. Requests are ordered exactly as before, but the validated query now always carries `order` (and `sort` when it has a default), so a subclass that read an absent `query.order` as "no order requested" sees the default instead.
