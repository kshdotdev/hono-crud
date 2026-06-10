---
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
"@hono-crud/drizzle": patch
---

Aggregate filters now fail closed on unknown operators across all adapters. Memory's `MemoryAggregateEndpoint` delegated to its own inline 6-operator switch with a fail-open default (unknown operators matched every record); it now delegates to `matchesFilter()`, the fail-closed single source of truth, and supports all 12 operators. Prisma's aggregate where-builder forwarded unrecognized operator strings verbatim into the Prisma where clause and 500'd on documented operators like `between`/`ilike`; it now validates with `isFilterOperator()` and delegates to `buildPrismaWhere`. Drizzle's aggregate path cast untrusted operator strings and crashed via `assertNever` on unknown operators; it now validates first and pushes a never-true condition instead. In every adapter an unknown operator now matches nothing (count 0) instead of leaking data or crashing.
