/**
 * Path params of a `registerCrud` base path (`/notes/:noteId/comments`).
 *
 * Nested registrations put params in the base path that no endpoint declares:
 * endpoints only know their own sub-route params (`:id`, `:version`). These
 * helpers declare the base-path params in the emitted doc and reject base
 * paths whose params collide with a sub-route's.
 */

import { z } from 'zod';
import { CRUD_ROUTES, type CrudEndpointName } from './crud-routes';
import { singularize } from './operation-id';
import type { OpenAPIRouteSchema } from './types';

/**
 * Param names in a Hono (`:noteId`, `:noteId{[0-9]+}`, `:noteId?`) or OpenAPI
 * (`{noteId}`) path, in order.
 */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split('/')) {
    const name = segment.startsWith(':')
      ? segment
          .slice(1)
          .replace(/\{.*\}$/, '')
          .replace(/\?$/, '')
      : /^\{(.+)\}$/.exec(segment)?.[1];
    if (name) names.push(name);
  }
  return names;
}

type ParamsObject = z.ZodObject<z.ZodRawShape>;

function isParamsObject(schema: unknown): schema is ParamsObject {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'shape' in schema &&
    typeof (schema as { extend?: unknown }).extend === 'function'
  );
}

/**
 * Declare each base-path param as a string path param. The OpenAPI spec
 * requires every `{param}` in a path to be declared; without this a nested
 * list (`GET /notes/{noteId}/comments`) documents none. Params the endpoint
 * (or a user `request.params` override) already declares keep their schema;
 * a params schema that isn't an object is left alone.
 *
 * Optional Hono params (`:scope?`) are skipped: the declared schema also
 * validates requests, so a required string would 400 every request that
 * omits the segment, and OpenAPI path params can't be optional anyway.
 */
export function declareBasePathParams(
  schema: OpenAPIRouteSchema,
  basePath: string,
): OpenAPIRouteSchema {
  const params = schema.request?.params;
  if (params !== undefined && !isParamsObject(params)) return schema;
  const declared = params?.shape ?? {};
  const requiredSegments = basePath.split('/').filter((segment) => !segment.endsWith('?'));
  const missing = pathParamNames(requiredSegments.join('/')).filter((name) => !(name in declared));
  if (missing.length === 0) return schema;
  const shape = Object.fromEntries(missing.map((name) => [name, z.string()]));
  const merged = params ? params.extend(shape) : z.object(shape);
  return {
    ...schema,
    request: {
      ...schema.request,
      params: merged as unknown as NonNullable<OpenAPIRouteSchema['request']>['params'],
    },
  };
}

/**
 * Fail at setup when a base-path param shares its name with a param of a
 * registered sub-route: `registerCrud(app, '/notes/:id/comments', { read })`
 * mounts `/notes/:id/comments/:id`, whose `id` resolves to the NOTE's id, so
 * every item request silently looks up the wrong record.
 */
export function assertNoBasePathParamClash(
  caller: string,
  basePath: string,
  slots: Iterable<CrudEndpointName>,
): void {
  const baseParams = new Set(pathParamNames(basePath));
  if (baseParams.size === 0) return;
  const registered = new Set(slots);
  for (const [name, , subPath] of CRUD_ROUTES) {
    if (!registered.has(name)) continue;
    const clash = pathParamNames(subPath).find((param) => baseParams.has(param));
    if (!clash) continue;
    throw new Error(
      `${caller}: base path "${basePath}" has a ":${clash}" param, which the ${name} route ` +
        `"${basePath}${subPath}" also uses, so its requests would read the base path's value. ` +
        `Rename the base-path param (e.g. ":${suggestParamName(basePath, clash)}").`,
    );
  }
}

/** `/notes/:id/comments` + `id` → `noteId`: the singular preceding segment + `Id`. */
function suggestParamName(basePath: string, param: string): string {
  const segments = basePath.split('/');
  const index = segments.findIndex((segment) => pathParamNames(segment)[0] === param);
  const parent = index > 0 ? singularize(segments[index - 1]).replace(/[^A-Za-z0-9]/g, '') : '';
  return parent ? `${parent}${param[0].toUpperCase()}${param.slice(1)}` : `parent${param}`;
}
