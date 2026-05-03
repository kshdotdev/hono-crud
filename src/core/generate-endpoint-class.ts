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
import type { HookMode, MetaInput, OpenAPIRouteSchema } from './types';

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
  searchFieldName?: string;
  sortFields?: string[];
  defaultSort?: { field: string; order: 'asc' | 'desc' };
  defaultPerPage?: number;
  maxPerPage?: number;
  allowedIncludes?: string[];
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];

  // Verb-specific protected field overrides for endpoints whose
  // configuration shape isn't part of the shared 5-verb surface
  // (search, aggregate, batch.*, export, import, upsert, clone).
  // Spread onto the generated subclass instance via Object.assign in
  // the constructor; absent keys leave the endpoint base-class default
  // in place.
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
export function generateEndpointClass<
  B extends abstract new () => unknown,
>(BaseClass: B, config: NormalizedEndpointConfig): B & (new () => InstanceType<B>) {
  const middlewares = config.middlewares ?? [];

  const extras = config.extras;

  // @ts-expect-error - TS cannot resolve members of a dynamically-provided abstract base class (TS#4628)
  const Generated = class extends BaseClass {
    static _middlewares = middlewares;

    constructor() {
      super();
      if (extras) {
        Object.assign(this, extras);
      }
    }

    _meta = config.meta;
    schema = (config.schema ?? {}) as OpenAPIRouteSchema;

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

    // List-specific
    protected filterFields: string[] = config.filterFields ?? [];
    protected filterConfig = config.filterConfig;
    protected searchFields: string[] = config.searchFields ?? [];
    protected searchFieldName: string = config.searchFieldName ?? 'search';
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

    // Body schema override (Create/Update)
    protected getBodySchema(): ZodObject<ZodRawShape> {
      if (config.bodySchema) return config.bodySchema;
      return super.getBodySchema();
    }

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
