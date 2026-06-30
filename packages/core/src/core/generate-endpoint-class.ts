/**
 * Single internal factory used by every public CRUD-class API
 * (`builder/`, `functional/`, `config/`).
 *
 * The previous design had three sugar APIs each independently re-emitting
 * the same anonymous-class extension via 15 separate `@ts-expect-error
 * TS#4628` suppressions. This module is the single source of truth — all
 * three callers normalize their input into `NormalizedEndpointConfig` and
 * delegate here.
 */

import type { MiddlewareHandler } from 'hono';
import type { ZodObject, ZodRawShape } from 'zod';
import type { CacheInvalidateInput } from './cache';
import type { HookMode, MetaInput, OpenAPIRouteSchema, SortSpec } from './types';

type AnyHook = (...args: unknown[]) => unknown;

/**
 * Normalized config consumed by `generateEndpointClass`.
 * The union of fields needed by every endpoint kind. Unused fields for a
 * given kind are simply ignored (the base class never reads them).
 */
export interface NormalizedEndpointConfig {
  meta: MetaInput;
  schema?: OpenAPIRouteSchema | Record<string, unknown>;
  middlewares?: MiddlewareHandler[];

  // Hooks (typed `unknown`-loose so the same factory handles
  // single-record / list / list-item shapes uniformly).
  before?: AnyHook;
  after?: AnyHook;
  transform?: AnyHook;
  beforeHookMode?: HookMode;
  afterHookMode?: HookMode;

  // Body schema override (Create/Update).
  bodySchema?: ZodObject<ZodRawShape>;

  // Create-specific.
  allowNestedCreate?: string[];

  // Read / Update / Delete shared.
  lookupField?: string;
  additionalFilters?: string[];

  // Update-specific.
  allowedUpdateFields?: string[];
  blockedUpdateFields?: string[];
  allowNestedWrites?: string[];

  // Delete-specific.
  includeCascadeResults?: boolean;

  // List-specific.
  filterFields?: string[];
  filterConfig?: Record<string, unknown>;
  searchFields?: string[];
  searchParamName?: string;
  sortFields?: string[];
  defaultSort?: SortSpec;
  defaultPerPage?: number;
  maxPerPage?: number;
  allowedIncludes?: string[];
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];
  // Keyset (cursor) pagination opt-in. `supportsCursorPagination` stays
  // adapter-owned — the loud ConfigurationException must still fire when an
  // adapter without keyset support is asked to cursor-paginate.
  cursorPaginationEnabled?: boolean;
  cursorField?: string;
  // Response cache (list/read) + invalidation (create/update/delete).
  cacheEnabled?: boolean;
  cacheTtlSeconds?: number;
  cacheKeyFields?: string[];
  cachePerUser?: boolean;
  cachePrefix?: string;
  cacheTags?: string[];
  cacheInvalidate?: CacheInvalidateInput;

  // Verb-specific protected field overrides for endpoints whose
  // configuration shape isn't part of the shared 5-verb surface
  // (search, aggregate, batch.*, export, import, upsert, clone).
  // Spread onto the generated subclass instance via Object.assign in
  // the constructor; absent keys leave the endpoint base-class default
  // in place.
  //
  // Kept loose (`Record<string, unknown>`) here so the factory stays
  // generic over base classes; the *value* contract is the typed
  // `*Extras` types in `endpoints/extras-config.ts`, which the config-API
  // build sites use so an unknown/misspelled key fails to compile.
  extras?: Record<string, unknown>;
}

/**
 * Build a concrete endpoint class by extending `BaseClass` with the fields
 * and hook delegations in `config`. The single `@ts-expect-error` here
 * replaces 15 copies that previously lived in builder/functional/config.
 *
 * The base class can be `abstract` (e.g. `MemoryCreateEndpoint`) but the
 * returned class is concrete — every member that was abstract on the base
 * becomes concrete here via the spread of `config`. TS doesn't know this so
 * the return type is widened to a non-abstract constructor.
 */
export function generateEndpointClass<B extends abstract new () => unknown>(
  BaseClass: B,
  config: NormalizedEndpointConfig,
): B & (new () => InstanceType<B>) {
  const middlewares = config.middlewares ?? [];

  const extras = config.extras;

  // Resolve the effective OpenAPI schema for this endpoint, defaulting
  // `tags` from the model's `tag` (or `tableName` when unset). A
  // per-endpoint `openapi.tags` override always wins — when the caller
  // already supplied a non-empty `tags` array we leave the schema
  // untouched, so existing behaviour for explicitly-tagged endpoints is
  // byte-identical. Only endpoints that previously had *no* tag now
  // inherit the resource-level group, which is the whole point of
  // `Model.tag`.
  const baseSchema = (config.schema ?? {}) as OpenAPIRouteSchema;
  const hasExplicitTags = Array.isArray(baseSchema.tags) && baseSchema.tags.length > 0;
  const resolvedTag = config.meta.model.tag ?? config.meta.model.tableName;
  const resolvedSchema: OpenAPIRouteSchema = hasExplicitTags
    ? baseSchema
    : { ...baseSchema, tags: [resolvedTag] };

  // @ts-expect-error - TS cannot resolve members of a dynamically-provided abstract base class (TS#4628)
  const Generated = class extends BaseClass {
    static _middlewares = middlewares;

    constructor() {
      super();
      if (extras) {
        Object.assign(this, extras);
      }
      // Body-schema override (Create/Update/batch-create/upsert family),
      // installed as an INSTANCE property and only when configured. A
      // class-level `getBodySchema` override delegating to `super` would make
      // every generated endpoint — including body-schema-less verbs like
      // BulkPatch whose base has no `getBodySchema` — pass the
      // `hasGetBodySchema` feature check and then crash on the missing super
      // implementation.
      if (config.bodySchema) {
        Object.assign(this, { getBodySchema: () => config.bodySchema });
      }
      // searchParamName is the ONE list-family knob whose default deliberately
      // differs between endpoint classes (ListEndpoint inline search:
      // 'search'; SearchEndpoint /search route: 'q'), so the factory must not
      // own a default for it — a class-field `= 'search'` here would shadow
      // SearchEndpoint's 'q'. Assigned only when explicitly configured.
      if (config.searchParamName !== undefined) {
        Object.assign(this, { searchParamName: config.searchParamName });
      }
    }

    _meta = config.meta;
    schema = resolvedSchema;

    // Hook modes (Create / Update / Delete)
    protected beforeHookMode: HookMode = config.beforeHookMode ?? 'sequential';
    protected afterHookMode: HookMode = config.afterHookMode ?? 'sequential';

    // Create-specific
    protected allowNestedCreate: string[] = config.allowNestedCreate ?? [];

    // Read / Update / Delete shared
    protected lookupField: string = config.lookupField ?? 'id';
    protected additionalFilters: string[] | undefined = config.additionalFilters;

    // Update-specific
    protected allowedUpdateFields: string[] | undefined = config.allowedUpdateFields;
    protected blockedUpdateFields: string[] | undefined = config.blockedUpdateFields;
    protected allowNestedWrites: string[] = config.allowNestedWrites ?? [];

    // Delete-specific
    protected includeCascadeResults: boolean = config.includeCascadeResults ?? false;

    // List-specific (searchParamName is assigned in the constructor — see
    // the endpoint-owned-default note there)
    protected filterFields: string[] = config.filterFields ?? [];
    protected filterConfig = config.filterConfig;
    protected searchFields: string[] = config.searchFields ?? [];
    protected sortFields: string[] = config.sortFields ?? [];
    protected defaultSort = config.defaultSort;
    protected defaultPerPage: number = config.defaultPerPage ?? 20;
    protected maxPerPage: number = config.maxPerPage ?? 100;
    protected allowedIncludes: string[] = config.allowedIncludes ?? [];
    protected fieldSelectionEnabled: boolean = config.fieldSelectionEnabled ?? false;
    protected allowedSelectFields: string[] = config.allowedSelectFields ?? [];
    protected blockedSelectFields: string[] = config.blockedSelectFields ?? [];
    protected alwaysIncludeFields: string[] = config.alwaysIncludeFields ?? [];
    protected defaultSelectFields: string[] = config.defaultSelectFields ?? [];
    // Keyset pagination opt-in (config bridge). Only the enable flag + field
    // are config-settable; `supportsCursorPagination` remains adapter-owned.
    protected cursorPaginationEnabled: boolean = config.cursorPaginationEnabled ?? false;
    protected cursorField: string | undefined = config.cursorField;
    // Response cache (list/read) + invalidation (create/update/delete). Inert
    // on verbs that don't read these fields.
    protected cacheEnabled: boolean = config.cacheEnabled ?? false;
    protected cacheTtlSeconds: number | undefined = config.cacheTtlSeconds;
    protected cacheKeyFields: string[] | undefined = config.cacheKeyFields;
    protected cachePerUser: boolean | undefined = config.cachePerUser;
    protected cachePrefix: string | undefined = config.cachePrefix;
    protected cacheTags: string[] | undefined = config.cacheTags;
    protected cacheInvalidate: CacheInvalidateInput | undefined = config.cacheInvalidate;

    async before(...args: unknown[]): Promise<unknown> {
      if (config.before) return config.before(...args);
      return super.before(...args);
    }

    async after(...args: unknown[]): Promise<unknown> {
      if (config.after) return config.after(...args);
      return super.after(...args);
    }

    protected transform(item: unknown): unknown {
      if (config.transform) return config.transform(item);
      return super.transform(item);
    }
  };

  return Generated as unknown as B & (new () => InstanceType<B>);
}
