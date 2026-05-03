# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] — 2026-05-03

### Added
- `middlewares?: MiddlewareHandler[]` slot on every per-endpoint config in `EndpointsConfig<M>` (`create`, `list`, `read`, `update`, `delete`, `search`, `aggregate`, `restore`, `batchCreate`, `batchUpdate`, `batchDelete`, `batchRestore`, `batchUpsert`, `export`, `import`, `upsert`, `clone`). Middleware listed here runs before the endpoint handler. The existing `RegisterCrudOptions.endpointMiddlewares` continues to work and overrides config-API middlewares for the same verb. Coverage: `tests/per-endpoint-middlewares.test.ts`.

### Fixed
- `HonoOpenAPIHandler.registerRoute` was passing the OpenAPI-style path (`/widgets/{id}`) to `app.use(...)` for per-route middleware. Hono's `use` expects the route-syntax form (`/widgets/:id`), so middleware on dynamic-segment routes (e.g., `delete`, `read`, `update`, `restore`, `clone`) silently never fired. The fix passes the raw path to `app.use(...)` and keeps the OpenAPI conversion only for `createRoute({ path })`. This unblocks both the new config-API `middlewares` slot and the existing `RegisterCrudOptions.endpointMiddlewares` option on `:id` routes.

### Compatibility
- Additive. Existing consumers see no behaviour change other than the bugfix above (middleware that previously was silently dropped on `:id` routes will now run as documented).

%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
%b
## [0.1.0] - 2025-01-29

### Added

- Initial release
- Full CRUD operations (Create, Read, Update, Delete)
- OpenAPI/Swagger documentation generation
- Swagger UI and Scalar API reference support
- Memory adapter for prototyping and testing
- Drizzle ORM adapter with transaction support
- Prisma adapter with transaction support
- Zod schema validation
- TypeScript support with full type inference
- `setContextVar` helper for context variable management
- `HonoCrudEnv` type export for custom middleware
- Configurable pagination and filtering
- Custom route overrides
- Edge runtime support (Cloudflare Workers, Deno, Bun, Node.js)

[0.1.0]: https://github.com/ksh-us/hono-crud/releases/tag/v0.1.0

[0.1.1]: https://github.com/ksh-us/hono-crud/compare/v0.0.0...v0.1.1
[0.1.2]: https://github.com/ksh-us/hono-crud/compare/v0.1.1...v0.1.2
[0.1.3]: https://github.com/ksh-us/hono-crud/compare/v0.1.2...v0.1.3
[0.1.4]: https://github.com/kshdotdev/hono-crud/compare/v0.1.3...v0.1.4
[0.2.0]: https://github.com/kshdotdev/hono-crud/compare/v0.1.4...v0.2.0
[0.3.0]: https://github.com/kshdotdev/hono-crud/compare/v0.2.0...v0.3.0
[0.3.1]: https://github.com/kshdotdev/hono-crud/compare/v0.3.0...v0.3.1
[0.3.2]: https://github.com/kshdotdev/hono-crud/compare/v0.3.1...v0.3.2
[0.4.0]: https://github.com/kshdotdev/hono-crud/compare/v0.3.2...v0.4.0
[0.4.1]: https://github.com/kshdotdev/hono-crud/compare/v0.4.0...v0.4.1
[0.4.2]: https://github.com/kshdotdev/hono-crud/compare/v0.4.1...v0.4.2
[0.4.3]: https://github.com/kshdotdev/hono-crud/compare/v0.4.2...v0.4.3
[0.4.4]: https://github.com/kshdotdev/hono-crud/compare/v0.4.3...v0.4.4
[0.5.0]: https://github.com/kshdotdev/hono-crud/compare/v0.4.4...v0.5.0
[0.5.1]: https://github.com/kshdotdev/hono-crud/compare/v0.5.0...v0.5.1
[0.5.2]: https://github.com/kshdotdev/hono-crud/compare/v0.5.1...v0.5.2
[0.5.3]: https://github.com/kshdotdev/hono-crud/compare/v0.5.2...v0.5.3
[0.6.0]: https://github.com/kshdotdev/hono-crud/compare/v0.5.3...v0.6.0
[0.7.0]: https://github.com/kshdotdev/hono-crud/compare/v0.6.0...v0.7.0
[0.8.0]: https://github.com/kshdotdev/hono-crud/compare/v0.7.0...v0.8.0
