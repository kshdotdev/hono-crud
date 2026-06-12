/**
 * Pure, synchronous OpenAPI paths emission.
 *
 * `toOpenApiPaths(endpoints, options?)` turns a `defineEndpoints(...)` result
 * (`GeneratedEndpoints`) into an OpenAPI 3.1 *paths fragment* —
 * `{ [path]: { [verb]: operation } }` — without a running server, without
 * `await`, and without calling `Model.resolveSchema()`.
 *
 * It exists so consumers (NestJS-style wrappers, doc aggregators, gateway
 * config generators) stop hand-deriving a lossy OpenAPI fragment from static
 * config. hono-crud already owns the authoritative per-endpoint
 * `OpenAPIRouteSchema` (every generated endpoint exposes `getSchema()`); this
 * function is the single source of truth for turning that into emitted
 * OpenAPI.
 *
 * For a statically-defined model (`defineModel({ schema: <zod object>, ... })`
 * with no `resolveSchema`), `endpoint.getSchema()` returns fully-populated
 * request/response Zod schemas synchronously — no context, no resolution
 * needed. This function feeds those through the exact same
 * `createRoute` + `OpenAPIHono` + `getOpenAPI31Document` pipeline that
 * `registerCrud`/`buildPerTenantOpenApi` use internally, then returns only
 * the `paths` object. Models that rely on the async `resolveSchema` hook for
 * per-tenant shapes still emit their *static* `schema` here (the documented
 * fallback) — use `buildPerTenantOpenApi(...)` when a resolved per-tenant
 * document is required.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';

import type { GeneratedEndpoints } from '../config/index';
import { CRUD_ROUTES, type CrudEndpointName } from '../core/crud-routes';
import type { OpenAPIRouteSchema } from '../core/types';
import { toOpenApiPath } from './utils';

/**
 * A single OpenAPI 3.1 Path Item: a map of lowercase HTTP verbs to
 * Operation objects (plus the occasional `parameters`/`$ref`). Kept as a
 * loose JSON-serializable record so this module doesn't leak the deep
 * `openapi3-ts` generic surface onto consumers — the values are plain
 * objects produced by `@hono/zod-openapi`'s document generator.
 */
export type OpenApiPathItem = Record<string, unknown>;

/**
 * Options for {@link toOpenApiPaths}.
 */
export interface ToOpenApiPathsOptions {
  /**
   * Prefix prepended to every emitted path key (e.g. `'/api/v1/users'`).
   * Slash-normalized: leading slash is ensured, duplicate slashes are
   * collapsed, a trailing slash is dropped. Defaults to `''` (paths are
   * emitted relative to the resource root, e.g. `/`, `/{id}`).
   */
  basePath?: string;
  /**
   * Override the OpenAPI tag for every emitted operation. When set, this
   * replaces whatever tag the endpoint's `getSchema()` resolved (model
   * `tag` / `tableName` / explicit `openapi.tags`). When unset, the
   * per-endpoint tags are preserved as-is.
   */
  tag?: string;
}

/**
 * The endpoint slots a `defineEndpoints(...)` result can carry, widened to
 * the full `CrudEndpointName` key space so the iteration below can index by
 * any row of `CRUD_ROUTES`. Rows for slots `defineEndpoints` never generates
 * (e.g. `bulkPatch`, `version*`) simply resolve to `undefined` and are
 * skipped.
 */
type EndpointSlots = Partial<
  Record<CrudEndpointName, GeneratedEndpoints[keyof GeneratedEndpoints]>
>;

/**
 * Join + normalize a base path and a relative sub-path into a single
 * OpenAPI path key: always one leading slash, no duplicate slashes, no
 * trailing slash (except the root `'/'`).
 */
function normalizePath(basePath: string, subPath: string): string {
  const joined = `/${basePath}/${subPath}`;
  const collapsed = joined.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

/**
 * Turn a `defineEndpoints(...)` result into an OpenAPI 3.1 paths fragment.
 *
 * Pure and synchronous: no `await`, no server start, no
 * `Model.resolveSchema()` invocation. Returns plain JSON-serializable
 * objects. Covers *every* endpoint `defineEndpoints` actually generated
 * (list/read/create/update/delete plus search/aggregate/upsert/restore/
 * clone/export/import and all `batch*` verbs) — completeness vs a
 * hand-rolled 5-verb subset is the entire point.
 *
 * @example
 * ```ts
 * const endpoints = defineEndpoints({ meta: userMeta, list: {}, create: {} }, MemoryAdapters);
 * const paths = toOpenApiPaths(endpoints, { basePath: '/api/users' });
 * // => { '/api/users': { get: {...}, post: {...} } }
 * ```
 */
export function toOpenApiPaths(
  endpoints: GeneratedEndpoints,
  options: ToOpenApiPathsOptions = {},
): Record<string, OpenApiPathItem> {
  const basePath = options.basePath ?? '';
  const tagOverride = options.tag;

  // Accumulate every generated route on a throwaway OpenAPIHono, then ask
  // it for a single 3.1 document and lift out `.paths`. This reuses the
  // exact zod -> JSON-Schema conversion the live router uses, so the
  // fragment is byte-identical to what `registerCrud` + `app.doc(...)`
  // would emit for the same endpoints.
  const app = new OpenAPIHono();
  let registered = 0;
  const endpointSlots: EndpointSlots = endpoints;

  for (const [name, method, subPath] of CRUD_ROUTES) {
    const EndpointClass = endpointSlots[name];
    if (!EndpointClass) continue;

    // Instantiate purely to read the authoritative schema. No
    // setContext()/resolveModelSchema() — for a static model this yields
    // fully-populated request/response schemas (see module docstring).
    const instance = new EndpointClass();
    const schema = instance.getSchema();

    const effectiveSchema: OpenAPIRouteSchema =
      tagOverride !== undefined ? { ...schema, tags: [tagOverride] } : schema;

    const path = normalizePath(basePath, toOpenApiPath(subPath));

    const routeConfig = createRoute({
      // `OpenAPIRouteSchema` is a structural subset of zod-openapi's
      // `RouteConfig` (no required `method`/`path`); the cast widens the
      // `responses` union TS can't unify on its own. Same cast shape used
      // by `openapi/lazy.ts`.
      ...(effectiveSchema as Parameters<typeof createRoute>[0]),
      method,
      path,
      responses: effectiveSchema.responses ?? {
        200: {
          description: 'Success',
          content: {
            // `z.unknown()` (not `z.any()`, which the edge-safety static
            // scan bans) is the unconstrained placeholder; both serialize
            // to the same open OpenAPI schema.
            'application/json': { schema: z.unknown() },
          },
        },
      },
    });

    // Dummy handler — never invoked; we only want the schema registered
    // so the generator can emit it.
    app.openapi(routeConfig, () => new Response());
    registered += 1;
  }

  if (registered === 0) {
    return {};
  }

  const doc = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'hono-crud', version: '1.0.0' },
  });

  // `paths` is optional on the OpenAPI object type; an empty document
  // would omit it. We registered at least one route, so it's present —
  // fall back to `{}` defensively rather than asserting non-null.
  const paths = (doc as { paths?: Record<string, OpenApiPathItem> }).paths;
  return paths ?? {};
}
