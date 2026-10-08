---
'hono-crud': patch
---

Aggregate filters now honor `AggregateEndpoint.filterFields` (and `defineEndpoints({ aggregate: { fields } })`), which were accepted but never read. Every unreserved query key used to become a filter, so `?page=1` or a typo reached the adapter as a column name (drizzle threw on it). Filters are now limited to `filterFields`, or every model field except `fieldEncryption` fields and the multi-tenant field when it is empty; other keys are ignored. Values are converted and checked against the field type like list filters, so `?role=admn` on an enum field is `400 VALIDATION_ERROR`, and the OpenAPI document (and MCP aggregate tool) declares the filterable fields, typing enum fields with their members.

If you already set `filterFields` (or `aggregate: { fields }`), filters on fields outside that list are now ignored, so add any field you still filter by. A database column that isn't in the model schema is filterable only when listed, and its value is passed through as a string.
