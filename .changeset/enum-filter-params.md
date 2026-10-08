---
'hono-crud': patch
---

List, search, and export document the single-value filters (`?field=` and `?field[ne|gt|gte|lt|lte]=`) on a string `z.enum` or `z.literal` field as that enum instead of `type: string`, so a client generated from the OpenAPI document (and the MCP list, search, and export tools) sees the allowed values, and the request validator rejects a typo with `400 VALIDATION_ERROR`. Comma-list (`in`, `nin`, `between`), substring (`like`, `ilike`), and `null` filters stay strings, as do all filter params on a model with `resolveSchema`. The param is rebuilt from the enum members, so the field's `.default()`, description, and component id stay off it.
