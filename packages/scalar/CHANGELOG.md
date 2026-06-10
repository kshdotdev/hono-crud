# @hono-crud/scalar

## 0.1.2

### Patch Changes

- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.

## 0.1.1

### Patch Changes

- b880e53: Type-safety hardening (phase 1): eliminate type/schema drift and silent fall-throughs.

  - **Unify `HonoOpenAPIApp`.** The publicly re-exported type was a 4-verb subset that disagreed with the 7-verb superset `fromHono` actually returns; both now resolve to one canonical definition, so typing the documented `HonoOpenAPIApp` and calling `.options()`/`.head()`/`.doc()` type-checks.
  - **Closed-union exhaustiveness.** Filter-operator handling now goes through a single shared `matchesFilter` in the in-memory adapter (the four copy-pasted switches had drifted — one was missing `between` and silently matched every row), and the Drizzle/Prisma/aggregate switches gained `assertNever` exhaustiveness guards so a future operator is a compile error rather than a silent gap.
  - **Validate untrusted filter operators.** `parseFilterValue` no longer blindly casts an unrecognized `field[op]=value` token to `FilterOperator` (which downstream adapters silently ignored, disabling the filter); unknown operators now fall back to literal equality. `FilterOperator` is now derived from a single `as const` `FILTER_OPERATORS` source with an `isFilterOperator` guard.
  - **Scalar config.** `@hono-crud/scalar` no longer escapes its own typing via `as Record<string, unknown>`; `ScalarTheme` is derived from the upstream `ApiReferenceConfiguration` and `scalarUI` has an explicit return type.
  - **De-duplicated casts.** Added a localized `readResponseEnvelope(ctx)` accessor and a Drizzle `readCount`/`CountRow` helper, removing repeated inline casts.

  New exports: `FILTER_OPERATORS`, `isFilterOperator`, `assertNever`, `readResponseEnvelope` (from `hono-crud`); `readCount`/`CountRow` (from `@hono-crud/drizzle`). All additive; no breaking changes.
