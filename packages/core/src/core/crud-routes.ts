/**
 * Canonical CRUD route table — the single source of truth for every endpoint
 * slot `registerCrud(...)` can register: `[name, HTTP verb, sub-path]`.
 *
 * Leaf module by design (no imports), so both `core/register.ts` (runtime
 * registration) and `openapi/paths.ts` (pure paths emission) can consume it
 * without import cycles. Sub-paths are relative to the resource root; `''`
 * means the collection root. `registerCrud` registers `basePath + subPath`
 * verbatim, so the relative sub-paths and verbs here are byte-identical to
 * the routes that get mounted and to the OpenAPI fragment emitted from them.
 *
 * REGISTRATION ORDER INVARIANTS — array order IS registration order:
 *
 * 1. Collection routes (`create`, `list`) come first.
 * 2. Batch and named sub-routes (`/batch*`, `/search`, `/aggregate`,
 *    `/export`, `/import`, `/upsert`, `/bulk`) MUST be registered BEFORE the
 *    `:id` item routes, so e.g. `/batch` is not matched as an id parameter.
 * 3. `:id` item routes and their sub-routes (`/restore`, `/clone`) follow.
 * 4. Version sub-resource routes: `/versions/compare` MUST come BEFORE
 *    `/versions/:version` so "compare" isn't matched as a version id.
 */
export const CRUD_ROUTES = [
  // Collection-level routes (no :id parameter)
  ['create', 'post', ''],
  ['list', 'get', ''],
  // Batch routes — before :id routes so '/batch' is not matched as an id
  ['batchCreate', 'post', '/batch'],
  ['batchUpdate', 'patch', '/batch'],
  ['batchDelete', 'delete', '/batch'],
  ['batchRestore', 'post', '/batch/restore'],
  ['batchUpsert', 'post', '/batch/upsert'],
  // Named collection sub-routes — before :id routes
  ['search', 'get', '/search'],
  ['aggregate', 'get', '/aggregate'],
  ['export', 'get', '/export'],
  ['import', 'post', '/import'],
  ['upsert', 'post', '/upsert'],
  // Bulk-patch (collection-level) — before :id so '/bulk' is not an id
  ['bulkPatch', 'patch', '/bulk'],
  // Item-level routes (with :id parameter)
  ['read', 'get', '/:id'],
  ['update', 'patch', '/:id'],
  ['delete', 'delete', '/:id'],
  ['restore', 'post', '/:id/restore'],
  ['clone', 'post', '/:id/clone'],
  // Version sub-resource routes — '/versions/compare' before '/versions/:version'
  ['versionHistory', 'get', '/:id/versions'],
  ['versionCompare', 'get', '/:id/versions/compare'],
  ['versionRead', 'get', '/:id/versions/:version'],
  ['versionRollback', 'post', '/:id/versions/:version/rollback'],
] as const satisfies ReadonlyArray<
  readonly [string, 'get' | 'post' | 'put' | 'patch' | 'delete', string]
>;

/**
 * All CRUD endpoint names supported by registerCrud.
 * Derived from {@link CRUD_ROUTES} so the union can never drift from the
 * route table.
 */
export type CrudEndpointName = (typeof CRUD_ROUTES)[number][0];
