---
'@hono-crud/drizzle': patch
'@hono-crud/prisma': patch
'@hono-crud/memory': patch
---

Sorted list, search, and export reads now break ties on the primary key. A `?sort=` column with repeated values used to leave the order of tied rows to the database, which could differ per query, so an offset page walk could repeat one row and skip another. The adapters now order by the sort column, then each primary-key field in the same direction (`ORDER BY title ASC, id ASC`), so every page walk visits each row once, and `order=desc` is the exact reverse of `order=asc`. The memory adapter used to break ties by insertion order; it now uses the same primary-key order as the SQL adapters. Unsorted requests are unchanged.
