---
"hono-crud": patch
"@hono-crud/drizzle": patch
---

Type-safety hardening (phase 2): derive types from single `as const` / Zod sources so the compile-time union and its runtime validators can no longer drift.

- **Union single-sources.** `SortDirection`, `SearchMode`, `AggregateOperation`, `JWTAlgorithm` (core) and `DrizzleDialect` (drizzle) are now derived from exported `as const` arrays (`SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `JWT_ALGORITHMS`, `DRIZZLE_DIALECTS`). The three `z.enum(['asc','desc'])` schemas and the `z.enum(['any','all','phrase'])` schema now reference these arrays, and the aggregate query parser derives its runtime operation lists from `AGGREGATE_OPERATIONS` instead of hand-maintained copies.
- **Removed a redundant type.** The JWT middleware's `HonoAlgorithm` type and its hand-maintained `supported` allow-list were exact duplicates of `JWTAlgorithm`; both are gone (and with them two casts) — `validateAlgorithm` checks against `JWT_ALGORITHMS` directly.
- **`SortSpec`.** The repeated inline `{ field: string; order: 'asc' | 'desc' }` shape across list/search/builder/functional/config is now the named `SortSpec` type.
- **Schema-derived shapes.** `EncryptedValue` is inferred from a new `encryptedValueSchema` and `isEncryptedValue` validates with `.safeParse` (one shape, not a hand-written twin). `CrudEventType` is single-sourced from `CRUD_EVENT_TYPES`, and the webhook event-filter template-literal type derives from it, so a new event type can't silently become unfilterable.

New additive exports: `SORT_DIRECTIONS`, `SEARCH_MODES`, `AGGREGATE_OPERATIONS`, `SortDirection`, `SortSpec`, `JWT_ALGORITHMS`, `CRUD_EVENT_TYPES`, `encryptedValueSchema` (from `hono-crud`); `DRIZZLE_DIALECTS`, `readCount`, `CountRow` (from `@hono-crud/drizzle`). All derived types are structurally identical to what they replaced — no breaking changes.
