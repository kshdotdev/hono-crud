/**
 * Default OpenAPI `operationId`s for `registerCrud` routes.
 *
 * Without an `operationId`, client generators name each operation from its
 * method and path (`GET /api/notes/{id}/comments` → `getApiNotesByIdComments`).
 * The default here is `<verb><Resource>` — `listComments`, `getComment`,
 * `listNoteComments` — derived from the endpoint slot and the path passed to
 * `registerCrud`, so every consumer gets readable client functions without
 * setting `schema.operationId` on each class.
 *
 * The derivation is a public contract: the id becomes a function name in
 * generated clients, so any change to it renames those functions. The rules
 * below are therefore frozen; irregular names are fixed per endpoint with
 * `schema.operationId`, never by changing the rules.
 *
 * Resource phrase — the static segments of the base path, camelCased:
 * - a segment followed by a path param is singular (`/notes/:noteId/comments`
 *   → `NoteComments`), the last segment is plural for collection verbs and
 *   singular for item verbs, other segments are kept verbatim;
 * - a base path with no static segment falls back to the model `tableName`.
 *
 * Because the phrase comes from the path, distinct base paths almost always
 * get distinct ids; the rare collision (`/comments` and `/comment` both give
 * `getComment`) fails at setup instead of emitting a duplicate. Ids are NOT
 * checked across apps mounted under different prefixes (`app.route('/v1', a)`
 * and `app.route('/v2', b)`): the mount prefix is invisible at registration.
 * A prefix in the registered path itself, by contrast, is part of the id
 * (`/api/comments` → `listApiComments`); register on a sub-app mounted at
 * the prefix to keep it out.
 */

import type { CRUD_ROUTES, CrudEndpointName } from './crud-routes';
import type { OpenAPIRouteSchema } from './types';

/** What a custom {@link OperationIdsOption} naming function receives. */
export interface OperationIdContext {
  /** The `registerCrud` slot (`list`, `read`, `batchCreate`, ...). */
  operation: CrudEndpointName;
  /** HTTP verb of the route, lowercase. */
  method: (typeof CRUD_ROUTES)[number][1];
  /** Base path as registered, joined with the slot's sub-path (`/comments/:id`). */
  path: string;
  /** Base path as registered (`/notes/:noteId/comments`). */
  basePath: string;
  /** The endpoint's model, when it has one. */
  model?: { tableName: string; tag?: string };
  /** The built-in default, so a strategy can adjust it rather than rebuild it. */
  defaultId: string | undefined;
}

/**
 * Controls default `operationId` generation. `false` turns it off, so routes
 * without an explicit `schema.operationId` emit none (the pre-default doc). A
 * function replaces the built-in naming: its return value becomes the id, and
 * `undefined` omits it. An explicit `schema.operationId` always wins.
 *
 * @example
 * ```ts
 * // Prefix ids for an app mounted at /v2 so they don't clash with /v1.
 * fromHono(new OpenAPIHono(), { operationIds: ({ defaultId }) => defaultId && `v2_${defaultId}` });
 * ```
 */
export type OperationIdsOption = false | ((ctx: OperationIdContext) => string | undefined);

/** The `registerCrud` slot a route was registered for, and its base path. */
export interface CrudRouteHint {
  operation: CrudEndpointName;
  basePath: string;
}

type Form = 'one' | 'many';

/**
 * `read` is `get` (the generator-idiomatic spelling); every other slot keeps
 * its own name as the verb. `form` picks the singular or plural resource
 * phrase; version routes name the version sub-resource after the record.
 */
const VERBS = {
  create: { verb: 'create', form: 'one' },
  list: { verb: 'list', form: 'many' },
  batchCreate: { verb: 'batchCreate', form: 'many' },
  batchUpdate: { verb: 'batchUpdate', form: 'many' },
  batchDelete: { verb: 'batchDelete', form: 'many' },
  batchRestore: { verb: 'batchRestore', form: 'many' },
  batchUpsert: { verb: 'batchUpsert', form: 'many' },
  search: { verb: 'search', form: 'many' },
  aggregate: { verb: 'aggregate', form: 'many' },
  export: { verb: 'export', form: 'many' },
  import: { verb: 'import', form: 'many' },
  upsert: { verb: 'upsert', form: 'one' },
  bulkPatch: { verb: 'bulkPatch', form: 'many' },
  read: { verb: 'get', form: 'one' },
  update: { verb: 'update', form: 'one' },
  delete: { verb: 'delete', form: 'one' },
  restore: { verb: 'restore', form: 'one' },
  clone: { verb: 'clone', form: 'one' },
  versionHistory: { verb: 'list', form: 'one', suffix: 'Versions' },
  versionCompare: { verb: 'compare', form: 'one', suffix: 'Versions' },
  versionRead: { verb: 'get', form: 'one', suffix: 'Version' },
  versionRollback: { verb: 'rollback', form: 'one', suffix: 'Version' },
} as const satisfies Record<CrudEndpointName, { verb: string; form: Form; suffix?: string }>;

/** Words that are the same in both forms. */
const INVARIANT = new Set(['news', 'series', 'species']);

/**
 * Common REST plurals the suffix rules below get wrong (`movies` → `movy`,
 * `statuses` → `statuse`, `menus` kept plural). Each singular starts with its
 * plural's first letter, so the plural's casing of that letter carries over.
 */
const IRREGULAR = new Map([
  ['movies', 'movie'],
  ['cookies', 'cookie'],
  ['calories', 'calorie'],
  ['caches', 'cache'],
  ['statuses', 'status'],
  ['aliases', 'alias'],
  ['buses', 'bus'],
  ['bonuses', 'bonus'],
  ['campuses', 'campus'],
  ['viruses', 'virus'],
  ['analyses', 'analysis'],
  ['diagnoses', 'diagnosis'],
  ['quizzes', 'quiz'],
  ['indices', 'index'],
  ['vertices', 'vertex'],
  ['matrices', 'matrix'],
  ['menus', 'menu'],
  ['skus', 'sku'],
  ['cpus', 'cpu'],
  ['gpus', 'gpu'],
  ['apis', 'api'],
  ['uris', 'uri'],
  ['kpis', 'kpi'],
  ['emojis', 'emoji'],
  ['wikis', 'wiki'],
]);

/**
 * Frozen English singularizer — deliberately small, see the module note.
 * `categories` → `category`, `addresses` → `address`, `boxes` → `box`,
 * `status` → `status`, `comments` → `comment`; `people` stays `people`.
 * The word lists match the last word of a compound (`OrderStatuses`,
 * `order-statuses` → `OrderStatus`, `order-status`).
 */
export function singularize(word: string): string {
  const last = /[A-Z]?[a-z0-9]*$/.exec(word)?.[0] ?? '';
  const lastLower = last.toLowerCase();
  if (INVARIANT.has(lastLower)) return word;
  const irregular = IRREGULAR.get(lastLower);
  if (irregular) return `${word.slice(0, -last.length)}${last[0]}${irregular.slice(1)}`;
  const lower = word.toLowerCase();
  if (lower.endsWith('ies') && lower.length > 3) return `${word.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(lower)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(lower)) return word;
  if (lower.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** `user-profiles` / `user_profiles` → `UserProfiles`; `''` when no letters or digits. */
function pascal(segment: string): string {
  return segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

/** A Hono (`:id`) or OpenAPI (`{id}`) path param. */
const isParam = (segment: string): boolean => segment.startsWith(':') || /^\{.+\}$/.test(segment);

/**
 * The default `operationId` for a `registerCrud` slot, or `undefined` when
 * neither the base path nor the table name yields a resource phrase.
 */
export function defaultOperationId(
  operation: CrudEndpointName,
  basePath: string,
  tableName?: string,
): string | undefined {
  const { verb, form, ...rest } = VERBS[operation];
  const suffix = 'suffix' in rest ? rest.suffix : '';
  const segments = basePath.split('/').filter((segment) => segment && segment !== '*');
  let lastStatic = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!isParam(segments[i])) {
      lastStatic = i;
      break;
    }
  }

  const words: string[] = [];
  if (lastStatic === -1) {
    if (tableName) words.push(form === 'one' ? singularize(pascal(tableName)) : pascal(tableName));
  } else {
    segments.forEach((segment, i) => {
      if (isParam(segment)) return;
      const word = pascal(segment);
      const followedByParam = i + 1 < segments.length && isParam(segments[i + 1]);
      const singular = i === lastStatic ? form === 'one' : followedByParam;
      words.push(singular ? singularize(word) : word);
    });
  }

  const resource = words.join('');
  return resource ? `${verb}${resource}${suffix}` : undefined;
}

/**
 * Apply the default (or strategy-named) `operationId` to an endpoint's
 * resolved schema. An explicit `schema.operationId` always wins;
 * `operationIds: false` leaves the schema untouched.
 */
export function applyDefaultOperationId(
  schema: OpenAPIRouteSchema,
  route: Pick<OperationIdContext, 'operation' | 'method' | 'path' | 'basePath'>,
  model: { tableName: string; tag?: string } | undefined,
  option: OperationIdsOption | undefined,
): OpenAPIRouteSchema {
  if (schema.operationId !== undefined || option === false) return schema;
  const defaultId = defaultOperationId(route.operation, route.basePath, model?.tableName);
  const operationId = option ? option({ ...route, model, defaultId }) : defaultId;
  return operationId === undefined ? schema : { ...schema, operationId };
}
