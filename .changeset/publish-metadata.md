---
"@hono-crud/cache": patch
"@hono-crud/drizzle": patch
"@hono-crud/health": patch
"@hono-crud/idempotency": patch
"@hono-crud/mcp": patch
"@hono-crud/memory": patch
"@hono-crud/prisma": patch
"@hono-crud/rate-limit": patch
"@hono-crud/scalar": patch
"@hono-crud/swagger": patch
---

Publishing metadata fixes: `CHANGELOG.md` is now included in the published npm artifact (it was missing from the `files` allowlist everywhere except core), and the lazily-loaded libraries `drizzle-zod` (drizzle), `pluralize` and `fastest-levenshtein` (prisma) are now optional peer dependencies — they are dynamically imported with graceful fallbacks, so consumers who don't use those features no longer have to install them.
