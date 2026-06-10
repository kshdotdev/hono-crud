---
"@hono-crud/prisma": patch
---

Fix `buildPrismaWhere` dropping conditions when a field had more than one filter operator. List and search queries like `?views[gte]=100&views[lte]=200` silently lost the `gte` because each condition overwrote the previous one per field; multiple conditions on one field now combine into a top-level `AND`.
