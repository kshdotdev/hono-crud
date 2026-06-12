---
"hono-crud": patch
"@hono-crud/cache": patch
"@hono-crud/memory": patch
"@hono-crud/drizzle": patch
"@hono-crud/prisma": patch
---

Adapter correctness batch:

- **Prisma soft-delete**: `read` and `update` now exclude soft-deleted rows (previously deleted data stayed readable and updatable on Prisma only), and `PrismaUpdateEndpoint` implements `findExisting` — restoring write policies, ETag If-Match, versioning, and audit prior-state capture that silently no-oped.
- **Prisma wiring parity**: new `getPrismaClient` resolver (`_tx` → class field → `CONTEXT_KEYS.prismaClient` context slot) and `createPrismaCrud(prisma, meta)` factory mirroring the Drizzle adapter; the `prisma` class field is now optional.
- **Upsert match-and-restore**: upsert/import/batchUpsert now match soft-deleted rows and clear the soft-delete field on update, identically across all three adapters (previously single upsert skipped soft-deleted rows — unique-constraint errors on SQL — while batch upsert overwrote them without restoring). Drizzle native ON CONFLICT paths document their divergence.
- **BatchDelete** responses go through the full finalize pipeline (computed fields, serialization profile, transform) instead of serializer-only.
- **like/ilike contract**: one cross-adapter definition — literal substring needle (`%` stripped, `_` inert), `like` follows database collation case behavior, `ilike` always case-insensitive. Drizzle no longer passes live user wildcards into SQL LIKE and no longer emits PostgreSQL-only `ILIKE` on sqlite/mysql.
- **Workers waitUntil**: logging flush, cache invalidation (`withCacheInvalidation`), api-key `updateLastUsed`, and error-handler hooks now register through `waitUntil` so they survive the response on Cloudflare Workers. `emitAsync` removed (zero call sites). One exported `WaitUntil` type (`WaitUntilFn` removed).
- **Prisma LIKE wildcard leak**: Prisma's `contains` compiles to SQL LIKE without escaping, so user-supplied `_` acted as a live single-char wildcard in like/ilike filters and search (verified against Postgres). Needles are now escaped via `escapeLikeWildcards`.
- **Prisma `useTransaction` honored**: Create/Update/Delete now wrap `handle()` in `$transaction` when `useTransaction = true` (mirroring Drizzle) — previously the flag existed but did nothing on single-record verbs, so hooks saw no transaction and an after-hook throw did not roll back the write.
