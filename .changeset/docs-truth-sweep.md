---
"hono-crud": patch
"@hono-crud/cache": patch
"@hono-crud/prisma": patch
---

Docs truth sweep — every shipped code sample now typechecks against the real API, plus the type-level fixes that pass surfaced:

- `withCache` / `withCacheInvalidation` / `withAuth` now accept abstract base classes and return an extendable constructor type. The documented `class X extends withCache(MemoryReadEndpoint)` pattern previously failed to compile for consumers (adapter endpoint classes are abstract, and the old `TBase & Constructor<...>` return type could not be extended — TS2510). Behavior unchanged; types only (`AbstractConstructor` is exported from `hono-crud/internal`).
- `PendingActionSchema` is now exported from `hono-crud/auth` — its JSDoc already directed storage-adapter authors to validate rows with it, but it was never re-exported.
- `PrismaClient` (the structural client constraint) is now exported from `@hono-crud/prisma` so consumers can name the type that `prisma = ...` and `createPrismaCrud(...)` accept.
- Corrected shipped JSDoc: the `withCache` and `AuthenticatedEndpoint` examples no longer show a `handle(ctx)` override (the registrar injects context; `handle()` is parameterless), and the lifecycle-hook docs no longer claim `fire-and-forget` is the default `afterHookMode` (the default is `sequential`).
