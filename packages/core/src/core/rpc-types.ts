/**
 * Type-level support for Hono's typed RPC client (`hc<typeof app>`).
 *
 * Hono accumulates a `Schema` generic on the app as routes are registered;
 * `hc<typeof app>` turns that schema into a typed client and
 * `InferRequestType` / `InferResponseType` read the request and response
 * shapes back out of it. Class routes registered through `fromHono`'s proxy
 * and CRUD verbs registered through `registerCrud` do not go through Hono's
 * own `.get(path, handler)` typing, so this module derives the equivalent
 * schema entries for them:
 *
 * - {@link RouteClassEntry} — for an `OpenAPIRoute` subclass, from its
 *   `schema` property (request `params`/`query`/`headers`/`cookies`/JSON or
 *   form body → `input`; every JSON response → a status-narrowed
 *   `TypedResponse`). Declare the property as
 *   `schema = { … } satisfies OpenAPIRouteSchema` (or through
 *   `defineRouteSchema`) so status-code keys and zod identities stay literal.
 * - {@link CrudSchema} — for the endpoints record handed to `registerCrud`,
 *   transcribed from each verb's generated `getSchema()` (the same envelope
 *   the OpenAPI document declares). Row types come from the endpoint's
 *   `_meta.model.schema`; create bodies from `meta.fields` when declared.
 *
 * Everything here is pure type space: no runtime code, no `any`, and only
 * `hono` + `zod` type imports so the module stays edge-neutral.
 */

import type { Input, MergePath, Schema, ToSchema, TypedResponse } from 'hono/types';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import type { JSONParsed, UnionToIntersection } from 'hono/utils/types';
import type { ZodType, z } from 'zod';
import type { OpenAPIRouteSchema } from './types';

// ============================================================================
// Shared helpers
// ============================================================================

/** The empty object type, spelled without the banned `{}`. */
export type EmptyObject = Record<never, never>;

/** Narrow an inferred value to a zod schema, else `never`. */
type ZodOf<T> = T extends ZodType ? T : never;

/** `true` for JSON media types (`application/json`, `application/vnd.x+json`, …). */
type IsJsonMedia<K> = K extends `application/${infer Start}json${string}`
  ? Start extends '' | `${string}+` | `vnd.${string}+`
    ? true
    : false
  : false;

/** `true` for form media types (multipart or URL-encoded). */
type IsFormMedia<K> = K extends
  | `multipart/form-data${string}`
  | `application/x-www-form-urlencoded${string}`
  ? true
  : false;

/** The zod schema declared under `content[mediaType].schema`, else `never`. */
type MediaSchema<C, K extends keyof C> = C[K] extends { schema: infer Z } ? ZodOf<Z> : never;

// ============================================================================
// Paths
// ============================================================================

/**
 * Convert OpenAPI-style `{id}` path segments to Hono's `:id` form. Hono-style
 * paths pass through unchanged, so it is safe to apply to both spellings.
 */
export type ToHonoPath<P extends string> = P extends `${infer Start}/{${infer Param}}${infer Rest}`
  ? `${Start}/:${Param}${ToHonoPath<Rest>}`
  : P;

// ============================================================================
// Request → client input
// ============================================================================

type RequestOf<S> = S extends { request: infer R } ? (R extends object ? R : never) : never;

/** The zod schema declared for a request part (`params`, `query`, …), else `never`. */
type PartSchema<S, K extends string> = RequestOf<S> extends { [P in K]: infer Z }
  ? ZodOf<Z>
  : never;

type BodyContent<S> = RequestOf<S> extends { body: { content: infer C } }
  ? C extends object
    ? C
    : never
  : never;

/** The zod schema of the JSON request body, else `never`. */
type JsonBodySchema<S> = [BodyContent<S>] extends [never]
  ? never
  : {
      [K in keyof BodyContent<S>]: IsJsonMedia<K> extends true
        ? MediaSchema<BodyContent<S>, K>
        : never;
    }[keyof BodyContent<S>];

/** The zod schema of the form request body, else `never`. */
type FormBodySchema<S> = [BodyContent<S>] extends [never]
  ? never
  : {
      [K in keyof BodyContent<S>]: IsFormMedia<K> extends true
        ? MediaSchema<BodyContent<S>, K>
        : never;
    }[keyof BodyContent<S>];

type InPart<K extends string, Z> = [Z] extends [never]
  ? EmptyObject
  : Z extends ZodType
    ? { [P in K]: z.input<Z> }
    : EmptyObject;

type OutPart<K extends string, Z> = [Z] extends [never]
  ? EmptyObject
  : Z extends ZodType
    ? { [P in K]: z.output<Z> }
    : EmptyObject;

/**
 * The Hono `Input` derived from a route schema: `in` is what the client
 * sends (zod input types), `out` is what the validated handler sees.
 */
export type RouteSchemaInput<S> = {
  in: InPart<'param', PartSchema<S, 'params'>> &
    InPart<'query', PartSchema<S, 'query'>> &
    InPart<'header', PartSchema<S, 'headers'>> &
    InPart<'cookie', PartSchema<S, 'cookies'>> &
    InPart<'json', JsonBodySchema<S>> &
    InPart<'form', FormBodySchema<S>>;
  out: OutPart<'param', PartSchema<S, 'params'>> &
    OutPart<'query', PartSchema<S, 'query'>> &
    OutPart<'header', PartSchema<S, 'headers'>> &
    OutPart<'cookie', PartSchema<S, 'cookies'>> &
    OutPart<'json', JsonBodySchema<S>> &
    OutPart<'form', FormBodySchema<S>>;
};

// ============================================================================
// Responses → client output
// ============================================================================

type ResponsesOf<S> = S extends { responses: infer R } ? (R extends object ? R : never) : never;

/** Numeric status literal for a `responses` key (numbers and numeric strings). */
type StatusOf<K> = K extends StatusCode
  ? K
  : K extends `${infer N extends number}`
    ? N extends StatusCode
      ? N
      : never
    : never;

/** The JSON body type declared for one response entry, else `never`. */
type JsonResponseBody<R, K extends keyof R> = R[K] extends { content: infer C }
  ? {
      [MT in keyof C]: IsJsonMedia<MT> extends true
        ? C[MT] extends { schema: infer Z }
          ? Z extends ZodType
            ? z.output<Z>
            : never
          : never
        : never;
    }[keyof C]
  : never;

type DeclaredResponses<S> = [ResponsesOf<S>] extends [never]
  ? never
  : {
      [K in keyof ResponsesOf<S>]: [StatusOf<K>] extends [never]
        ? never
        : [JsonResponseBody<ResponsesOf<S>, K>] extends [never]
          ? never
          : TypedResponse<JSONParsed<JsonResponseBody<ResponsesOf<S>, K>>, StatusOf<K>, 'json'>;
    }[keyof ResponsesOf<S>];

/**
 * The response type of a route that declares no JSON responses: the route
 * still appears in the client, with an unknown body and any status.
 */
export type UntypedRouteResponse = TypedResponse<unknown, ContentfulStatusCode, 'json'>;

/**
 * Union of status-narrowed `TypedResponse`s, one per JSON response declared
 * in the route schema (`InferResponseType<…, 200>` picks the matching arm).
 */
export type RouteSchemaOutput<S> = [DeclaredResponses<S>] extends [never]
  ? UntypedRouteResponse
  : DeclaredResponses<S>;

// ============================================================================
// Class routes
// ============================================================================

/** The `schema` property type of an `OpenAPIRoute` subclass (the base shape when untyped). */
export type RouteClassSchema<C> = C extends new () => { schema: infer S } ? S : OpenAPIRouteSchema;

/**
 * The Hono schema entry produced by `app.<method>(path, RouteClass)`.
 * `BasePath` is the app's base path; `P` may use `:id` or `{id}` segments.
 */
export type RouteClassEntry<
  M extends string,
  P extends string,
  BasePath extends string,
  C,
> = ToSchema<
  M,
  MergePath<BasePath, ToHonoPath<P>>,
  RouteSchemaInput<RouteClassSchema<C>>,
  RouteSchemaOutput<RouteClassSchema<C>>
>;

// ============================================================================
// Envelopes
// ============================================================================

/** Default success body of every hono-crud endpoint. */
export interface SuccessEnvelope<T> {
  success: true;
  result: T;
}

/** Pagination metadata emitted by list endpoints. */
export interface ResultInfo {
  page: number;
  per_page: number;
  total_count?: number;
  total_pages?: number;
  has_next_page: boolean;
  has_prev_page: boolean;
  next_cursor?: string;
}

/** Default success body of list endpoints. */
export interface PaginatedEnvelope<T> {
  success: true;
  result: T[];
  result_info: ResultInfo;
}

/** Default error body (see `createErrorHandler` / `errorResponseSchema`). */
export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// CRUD resources
// ============================================================================

/** The `_meta` type carried by a CRUD endpoint class, else `never`. */
export type CrudMetaOf<C> = C extends new () => { _meta: infer M } ? M : never;

type ModelSchemaOf<M> = M extends { model: { schema: infer Z } } ? ZodOf<Z> : never;

/** The row type (zod output of `_meta.model.schema`) of a CRUD endpoint class. */
export type CrudRow<C> = [ModelSchemaOf<CrudMetaOf<C>>] extends [never]
  ? Record<string, unknown>
  : z.output<ModelSchemaOf<CrudMetaOf<C>>>;

type CrudRowInput<C> = [ModelSchemaOf<CrudMetaOf<C>>] extends [never]
  ? Record<string, unknown>
  : z.input<ModelSchemaOf<CrudMetaOf<C>>>;

/**
 * The create request body of a CRUD endpoint class: `meta.fields` when the
 * meta declares one (see `defineMeta`), otherwise a partial of the model
 * row — engine-managed fields (primary keys, timestamps) are resolved at
 * runtime, so the body cannot be narrowed further at the type level.
 */
export type CrudCreateInput<C> = CrudMetaOf<C> extends { fields: infer F }
  ? F extends ZodType
    ? z.input<F>
    : Partial<CrudRowInput<C>>
  : Partial<CrudRowInput<C>>;

/** The update request body of a CRUD endpoint class (`fields.partial()`). */
export type CrudUpdateInput<C> = Partial<CrudCreateInput<C>>;

/** Query string accepted by list endpoints (filters are open-ended). */
export interface CrudListQuery {
  page?: string;
  per_page?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  include?: string;
  fields?: string;
  cursor?: string;
  [filter: string]: string | undefined;
}

/** Query string accepted by read endpoints. */
export interface CrudReadQuery {
  include?: string;
  fields?: string;
}

/** Query string accepted by search endpoints. */
export interface CrudSearchQuery {
  q?: string;
  page?: string;
  per_page?: string;
  fields?: string;
  [filter: string]: string | undefined;
}

/** Result body of delete endpoints. */
export interface CrudDeleteResult {
  deleted: true;
  cascade?: {
    deleted: Record<string, number>;
    nullified: Record<string, number>;
  };
}

/** One hit of a search endpoint. */
export interface CrudSearchResultItem<T> {
  item: T;
  score: number;
  highlights?: Record<string, string[]>;
  matchedFields: string[];
}

/** Metadata of a search response. */
export interface CrudSearchResultInfo {
  page: number;
  per_page: number;
  total_count?: number;
  total_pages?: number;
  query: string;
  searchedFields: string[];
}

/** Success body of search endpoints. */
export interface SearchEnvelope<T> {
  success: true;
  result: CrudSearchResultItem<T>[];
  result_info: CrudSearchResultInfo;
}

type Json<T, S extends StatusCode> = TypedResponse<T, S, 'json'>;
type Err<S extends StatusCode> = Json<ErrorEnvelope, S>;
type Row<C> = JSONParsed<CrudRow<C>>;

/** Precise output for the default envelope; unknown for a custom `responseEnvelope`. */
type Out<Envelope extends 'default' | 'custom', Precise> = Envelope extends 'custom'
  ? UntypedRouteResponse
  : Precise;

type NoInput = { in: EmptyObject };
type QueryInput<Q> = { in: { query?: Q } };
type JsonInput<J> = { in: { json: J } };
type OptionalJsonInput<J> = { in: { json?: J } };

/** A route present in the client with unknown body (verbs without a precise template yet). */
type Loose<M extends string, P extends string> = ToSchema<M, P, NoInput, UntypedRouteResponse>;

/** Any constructible endpoint class. */
type AnyEndpointClass = abstract new (...args: never) => unknown;

/**
 * The schema entry for one registered CRUD slot `K` (an endpoint class `C`
 * mounted at `Base`). Transcribed from each verb's generated `getSchema()`.
 */
type CrudSlotEntry<
  K,
  Base extends string,
  C,
  Envelope extends 'default' | 'custom',
> = K extends 'create'
  ? ToSchema<
      'post',
      Base,
      JsonInput<CrudCreateInput<C>>,
      Out<Envelope, Json<SuccessEnvelope<Row<C>>, 201> | Err<400>>
    >
  : K extends 'list'
    ? ToSchema<
        'get',
        Base,
        QueryInput<CrudListQuery>,
        Out<Envelope, Json<PaginatedEnvelope<Row<C>>, 200> | Err<400>>
      >
    : K extends 'read'
      ? ToSchema<
          'get',
          `${Base}/:id`,
          QueryInput<CrudReadQuery>,
          Out<Envelope, Json<SuccessEnvelope<Row<C>>, 200> | Err<404>>
        >
      : K extends 'update'
        ? ToSchema<
            'patch',
            `${Base}/:id`,
            JsonInput<CrudUpdateInput<C>>,
            Out<Envelope, Json<SuccessEnvelope<Row<C>>, 200> | Err<400> | Err<404>>
          >
        : K extends 'delete'
          ? ToSchema<
              'delete',
              `${Base}/:id`,
              NoInput,
              Out<Envelope, Json<SuccessEnvelope<CrudDeleteResult>, 200> | Err<404> | Err<409>>
            >
          : K extends 'restore'
            ? ToSchema<
                'post',
                `${Base}/:id/restore`,
                NoInput,
                Out<Envelope, Json<SuccessEnvelope<Row<C>>, 200> | Err<400> | Err<404>>
              >
            : K extends 'clone'
              ? ToSchema<
                  'post',
                  `${Base}/:id/clone`,
                  OptionalJsonInput<CrudUpdateInput<C>>,
                  Out<Envelope, Json<SuccessEnvelope<Row<C>>, 201> | Err<404> | Err<409>>
                >
              : K extends 'upsert'
                ? ToSchema<
                    'post',
                    `${Base}/upsert`,
                    JsonInput<CrudCreateInput<C>>,
                    Out<
                      Envelope,
                      | Json<SuccessEnvelope<Row<C>> & { created: false }, 200>
                      | Json<SuccessEnvelope<Row<C>> & { created: true }, 201>
                      | Err<400>
                    >
                  >
                : K extends 'search'
                  ? ToSchema<
                      'get',
                      `${Base}/search`,
                      QueryInput<CrudSearchQuery>,
                      Out<Envelope, Json<SearchEnvelope<Row<C>>, 200> | Err<400>>
                    >
                  : K extends 'batchCreate'
                    ? Loose<'post', `${Base}/batch`>
                    : K extends 'batchUpdate'
                      ? Loose<'patch', `${Base}/batch`>
                      : K extends 'batchDelete'
                        ? Loose<'delete', `${Base}/batch`>
                        : K extends 'batchRestore'
                          ? Loose<'post', `${Base}/batch/restore`>
                          : K extends 'batchUpsert'
                            ? Loose<'post', `${Base}/batch/upsert`>
                            : K extends 'aggregate'
                              ? Loose<'get', `${Base}/aggregate`>
                              : K extends 'export'
                                ? Loose<'get', `${Base}/export`>
                                : K extends 'import'
                                  ? Loose<'post', `${Base}/import`>
                                  : K extends 'bulkPatch'
                                    ? Loose<'patch', `${Base}/bulk`>
                                    : K extends 'versionHistory'
                                      ? Loose<'get', `${Base}/:id/versions`>
                                      : K extends 'versionCompare'
                                        ? Loose<'get', `${Base}/:id/versions/compare`>
                                        : K extends 'versionRead'
                                          ? Loose<'get', `${Base}/:id/versions/:version`>
                                          : K extends 'versionRollback'
                                            ? Loose<
                                                'post',
                                                `${Base}/:id/versions/:version/rollback`
                                              >
                                            : never;

/**
 * The Hono schema produced by `registerCrud(app, basePath, endpoints)`.
 * `Base` is the fully merged mount path (`MergePath<AppBasePath, basePath>`).
 * `Envelope` is `'custom'` when a `responseEnvelope` option reshapes the
 * bodies, in which case every output degrades to `unknown`.
 *
 * Built as one mapped type over the registered slots (folded with
 * `UnionToIntersection`) rather than a fixed 22-way intersection: the
 * mapped form stays deferred inside generic signatures, where the eager
 * intersection made TypeScript give up ("union type too complex").
 */
export type CrudSchema<
  Base extends string,
  EP,
  Envelope extends 'default' | 'custom' = 'default',
> = UnionToIntersection<
  {
    [K in keyof EP]-?: EP[K] extends AnyEndpointClass
      ? CrudSlotEntry<K, Base, EP[K], Envelope>
      : never;
  }[keyof EP]
>;

/**
 * The Hono schema produced by `registerCrudResources(app, { [path]: endpoints })`:
 * every resource's {@link CrudSchema}, intersected.
 */
export type CrudResourcesSchema<
  BasePath extends string,
  R,
  Envelope extends 'default' | 'custom' = 'default',
> = UnionToIntersection<
  {
    [P in keyof R & string]: CrudSchema<MergePath<BasePath, ToHonoPath<P>>, R[P], Envelope>;
  }[keyof R & string]
>;

/** Re-exported so consumers can name the accumulated schema generic. */
export type { Input, Schema };
