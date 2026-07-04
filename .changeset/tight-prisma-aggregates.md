---
'@hono-crud/prisma': patch
---

Prisma adapter tightening: the delegate's `aggregate`/`groupBy` now return a structural `PrismaAggregateRow` (`_count`/`_sum`/`_avg`/`_min`/`_max` + group-key index signature), removing all fourteen result-reading double-casts and eight args-building casts in the aggregate paths; `groupAggregationsByOperation` is an exhaustive `Record<AggregateField['operation'], string[]>` lookup (a new aggregate operation fails to compile until it gets a bucket); the `options.groupBy!` assertion is replaced by a captured local; and `getPrismaModel` / the batch transaction lookups throw `ConfigurationException` (500 `CONFIGURATION_ERROR` envelope) instead of plain `Error` for unknown delegates, per the error-split doctrine.
