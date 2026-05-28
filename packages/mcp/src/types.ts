import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { CrudEndpointName, CrudEndpoints, OpenAPIRoute, OpenAPIRouteSchema } from 'hono-crud';
import type { MetaInput, PathPattern } from 'hono-crud/internal';

/**
 * The five standard CRUD operations exposed as MCP tools. Pinned to core's
 * `CrudEndpointName` via `Extract` so a rename in core surfaces as a compile
 * error here rather than silent drift.
 */
export type OperationName = Extract<
  CrudEndpointName,
  'list' | 'read' | 'create' | 'update' | 'delete'
>;

export const OPERATIONS: readonly OperationName[] = ['list', 'read', 'create', 'update', 'delete'];

export type Awaitable<T> = T | Promise<T>;

/**
 * MCP tool behavioural hints. Mirrors the MCP spec's tool annotations — these
 * are advisory signals an LLM client may surface to the user (e.g. flag a
 * destructive action before running it).
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Per-operation tool overrides. */
export interface ToolOptions {
  /** Full custom tool name. Overrides the naming strategy. */
  name?: string;
  /** Custom tool description. Overrides the auto-generated description. */
  description?: string;
  /** Set to `false` to exclude this operation. Defaults to `true`. */
  enabled?: boolean;
  /** MCP annotations, merged over the per-operation defaults. */
  annotations?: ToolAnnotations;
}

/** Per-resource configuration passed to {@link CrudMcpServer.resource}. */
export interface ResourceOptions {
  /** Resource label used in tool names. Defaults to the model `tag`/`tableName`, else the path. */
  name?: string;
  /** Base description applied to every tool generated for this resource. */
  description?: string;
  /** Allow-list of operations to expose. Defaults to every operation present in the endpoints map. */
  operations?: OperationName[];
  /** Per-operation overrides. */
  tools?: Partial<Record<OperationName, ToolOptions>>;
}

/** Context handed to a custom {@link CrudMcpOptions.naming} strategy. */
export interface NamingContext {
  resource: string;
  operation: OperationName;
}

/**
 * Controls the auto-discovery pass that turns every `registerCrud(...)` resource
 * into MCP tools without per-resource `mcp.resource()` calls. Set `auto: true`
 * for defaults, or pass this object to scope and override.
 */
export interface AutoOptions {
  /** Only auto-register resources whose path matches one of these (glob or RegExp). Default: all. */
  include?: PathPattern[];
  /** Skip resources whose path matches one of these. Excludes always win. */
  exclude?: PathPattern[];
  /** Default operation allow-list applied to every auto-registered resource. */
  operations?: OperationName[];
  /** Per-path overrides, keyed by the `registerCrud` path (e.g. `'/users'`). */
  resources?: Record<string, ResourceOptions>;
}

export type Identity = Record<string, unknown>;

/**
 * Verify a bearer token yourself. Return an identity on success (attached to the
 * Hono context as `auth`) or `null` to reject the request with `401`.
 * The simplest setup: the same token gates `/mcp` and the CRUD routes, so it is
 * forwarded verbatim on re-dispatch.
 */
export interface VerifierAuthOptions {
  strategy: 'verifier';
  verifyToken: (token: string, c: Context) => Awaitable<Identity | null>;
}

/** Gate `/mcp` with existing Hono middleware (e.g. `@hono-crud/core/auth`). */
export interface MiddlewareAuthOptions {
  strategy: 'middleware';
  middleware: MiddlewareHandler | MiddlewareHandler[];
}

/**
 * Full MCP OAuth 2.1. Decoupled by design: you build the metadata router and the
 * bearer-auth middleware yourself (e.g. with `@hono/mcp`'s `simpleMcpAuthRouter`
 * and `bearerAuth`), so this package never imports `hono-rate-limiter`.
 */
export interface OAuthAuthOptions {
  strategy: 'oauth';
  /** OAuth metadata router (mounted on the app), e.g. from `@hono/mcp`'s `simpleMcpAuthRouter`. */
  // biome-ignore lint/suspicious/noExplicitAny: a Hono router of any Env/Schema is acceptable to mount.
  router: Hono<any, any, any>;
  /** Where to mount the metadata router. Defaults to `/`. */
  mountPath?: string;
  /** Bearer-auth middleware gating `/mcp`, e.g. from `@hono/mcp`'s `bearerAuth`. */
  bearer: MiddlewareHandler;
}

export type McpAuthOptions = VerifierAuthOptions | MiddlewareAuthOptions | OAuthAuthOptions;

/** Options for {@link createCrudMcp}. */
export interface CrudMcpOptions {
  /** MCP server name advertised to clients. */
  name: string;
  /** MCP server version advertised to clients. */
  version: string;
  /** Free-form guidance surfaced to the LLM about how to use the tools. */
  instructions?: string;
  /** Tool naming strategy. Defaults to `` `${resource}_${operation}` ``. */
  naming?: (ctx: NamingContext) => string;
  /** Authentication for the `/mcp` endpoint. Defaults to none (open). */
  auth?: McpAuthOptions;
  /**
   * Auto-register every resource registered via `registerCrud(...)`. `true` uses
   * defaults; pass {@link AutoOptions} to scope/override. Manual `mcp.resource()`
   * calls still work and take precedence over auto for the same path.
   */
  auto?: boolean | AutoOptions;
}

/** The endpoints map — the same object passed to `registerCrud(app, path, endpoints)`. */
export type ResourceEndpoints = CrudEndpoints;

/** Structural shape of an instantiated CRUD endpoint we read schema/meta from. */
export type EndpointInstance = OpenAPIRoute & {
  _meta?: MetaInput;
  getSchema(): OpenAPIRouteSchema;
};
