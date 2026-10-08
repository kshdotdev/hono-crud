---
'hono-crud': patch
---

The version-history `limit` param is declared as an integer from 1 up to `maxLimit`, the same page-size definition list, search and cursor pagination use, and `offset` as an integer from 0. A fractional `limit` or `offset` such as `2.5` now answers 400 `VALIDATION_ERROR`.
