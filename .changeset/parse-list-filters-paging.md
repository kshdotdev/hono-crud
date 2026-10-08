---
'hono-crud': patch
---

`parseListFilters` parses `page`, `per_page` and the cursor `limit` with the same schema the list and search endpoints document, instead of its own parse-and-clamp. A list or search endpoint mounted without the route validator (a bare `app.get(path, handler)` that calls `setContext` and `handle`) now answers an out-of-range or non-integer paging value with 400 `VALIDATION_ERROR`, exactly as a registered endpoint does, where it used to clamp it. Direct callers of `parseListFilters` get an `InputValidationException` for the same values. Bulk patch and export ignore `page` / `per_page` entirely, mounted either way, since neither pages. They opt out through `offsetPaginationEnabled: false`, a new `ListFilterParseOptions` option (default `true`) that `ListEndpoint` also exposes as a protected field, so a custom list subclass that never pages can do the same.
