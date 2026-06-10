# @hono-crud/prisma

## 0.1.8

### Patch Changes

- Updated dependencies [8244828]
  - hono-crud@0.13.10

## 0.1.7

### Patch Changes

- dd62008: Aggregate filters now fail closed on unknown operators across all adapters. Memory's `MemoryAggregateEndpoint` delegated to its own inline 6-operator switch with a fail-open default (unknown operators matched every record); it now delegates to `matchesFilter()`, the fail-closed single source of truth, and supports all 12 operators. Prisma's aggregate where-builder forwarded unrecognized operator strings verbatim into the Prisma where clause and 500'd on documented operators like `between`/`ilike`; it now validates with `isFilterOperator()` and delegates to `buildPrismaWhere`. Drizzle's aggregate path cast untrusted operator strings and crashed via `assertNever` on unknown operators; it now validates first and pushes a never-true condition instead. In every adapter an unknown operator now matches nothing (count 0) instead of leaking data or crashing.
- dd62008: Fix `buildPrismaWhere` dropping conditions when a field had more than one filter operator. List and search queries like `?views[gte]=100&views[lte]=200` silently lost the `gte` because each condition overwrote the previous one per field; multiple conditions on one field now combine into a top-level `AND`.
- dd62008: Version rollback now returns 404 `NOT_FOUND` when the target record no longer exists, honoring the endpoint's declared OpenAPI contract. Previously the adapter threw a plain `Error`, which surfaced as 500 `INTERNAL_ERROR`.
- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- Updated dependencies [dd62008]
  - hono-crud@0.13.9

## 0.1.6

### Patch Changes

- 255aaf3: Thread a row/DB type generic through both ORM adapters so query results are typed instead of `unknown`, removing the internal `as ModelObject<...>` laundering casts. Breaking: the Drizzle adapter drops the `DrizzleDatabase`/`DrizzleDB` aliases (use `DrizzleDatabaseConstraint` or the new third `DB` generic on endpoint classes) and its public API no longer references drizzle-orm builder types (`Table`/`Column`/`SQL`); `PrismaModelOperations` gains a `Row` type parameter plus `aggregate`/`groupBy` members.

## 0.1.5

### Patch Changes

- b880e53: Type-safety hardening (phase 1): eliminate type/schema drift and silent fall-throughs.

  - **Unify `HonoOpenAPIApp`.** The publicly re-exported type was a 4-verb subset that disagreed with the 7-verb superset `fromHono` actually returns; both now resolve to one canonical definition, so typing the documented `HonoOpenAPIApp` and calling `.options()`/`.head()`/`.doc()` type-checks.
  - **Closed-union exhaustiveness.** Filter-operator handling now goes through a single shared `matchesFilter` in the in-memory adapter (the four copy-pasted switches had drifted — one was missing `between` and silently matched every row), and the Drizzle/Prisma/aggregate switches gained `assertNever` exhaustiveness guards so a future operator is a compile error rather than a silent gap.
  - **Validate untrusted filter operators.** `parseFilterValue` no longer blindly casts an unrecognized `field[op]=value` token to `FilterOperator` (which downstream adapters silently ignored, disabling the filter); unknown operators now fall back to literal equality. `FilterOperator` is now derived from a single `as const` `FILTER_OPERATORS` source with an `isFilterOperator` guard.
  - **Scalar config.** `@hono-crud/scalar` no longer escapes its own typing via `as Record<string, unknown>`; `ScalarTheme` is derived from the upstream `ApiReferenceConfiguration` and `scalarUI` has an explicit return type.
  - **De-duplicated casts.** Added a localized `readResponseEnvelope(ctx)` accessor and a Drizzle `readCount`/`CountRow` helper, removing repeated inline casts.

  New exports: `FILTER_OPERATORS`, `isFilterOperator`, `assertNever`, `readResponseEnvelope` (from `hono-crud`); `readCount`/`CountRow` (from `@hono-crud/drizzle`). All additive; no breaking changes.

- Updated dependencies [f8e5208]
- Updated dependencies [3ab0514]
- Updated dependencies [0538c4a]
- Updated dependencies [b880e53]
- Updated dependencies [a41b5d7]
- Updated dependencies [18a86c2]
  - hono-crud@0.13.8

## 0.1.4

### Patch Changes

- Updated dependencies [245ca0b]
  - hono-crud@0.13.7

## 0.1.3

### Patch Changes

- Updated dependencies [3278d26]
  - hono-crud@0.13.6

## 0.1.2

### Patch Changes

- Updated dependencies [c95d8dc]
  - hono-crud@0.13.5

## 0.1.1

### Patch Changes

- Updated dependencies [6c22eaa]
  - hono-crud@0.13.4
