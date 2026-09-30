---
'hono-crud': patch
---

The typed RPC client accepts numbers for list and search paging: `CrudListQuery` / `CrudSearchQuery` type `page` and `per_page` (and list `limit`) as `number | string`, so `client.items.$get({ query: { page: 2 } })` compiles without `String(...)`. hc stringifies the value into the URL and the endpoint coerces it back. `CrudListQuery` also gains `limit`, the cursor-pagination page size.
