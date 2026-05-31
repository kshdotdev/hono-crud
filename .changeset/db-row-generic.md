---
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
---

Thread a row/DB type generic through both ORM adapters so query results are typed instead of `unknown`, removing the internal `as ModelObject<...>` laundering casts. Breaking: the Drizzle adapter drops the `DrizzleDatabase`/`DrizzleDB` aliases (use `DrizzleDatabaseConstraint` or the new third `DB` generic on endpoint classes) and its public API no longer references drizzle-orm builder types (`Table`/`Column`/`SQL`); `PrismaModelOperations` gains a `Row` type parameter plus `aggregate`/`groupBy` members.
