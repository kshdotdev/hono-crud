# @hono-crud/swagger

## 0.1.1

### Patch Changes

- dd62008: Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
- dd62008: The docs-hub Scalar card now links to `/reference` (the path `@hono-crud/scalar` actually serves by default) instead of `/scalar`, which 404'd. The `scalarPath` option remains configurable.
