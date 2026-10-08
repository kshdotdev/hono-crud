---
'hono-crud': patch
---

Filters on a string `z.enum` or `z.literal` field now reject values outside the enum with `400 VALIDATION_ERROR`. A typo such as `?status=publised` used to reach the database as a raw string and return an empty page, while number, boolean, and date filters already failed loudly. The check covers every operator except `like`, `ilike`, and `null` (`in`, `nin`, and `between` check each item) on list, search, export, and bulk patch.
