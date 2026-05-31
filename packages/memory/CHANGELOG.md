# @hono-crud/memory

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
