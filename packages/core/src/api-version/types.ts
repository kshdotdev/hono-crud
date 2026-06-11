import type { Context, Env, MiddlewareHandler } from 'hono';

/**
 * Strategy for extracting the API version from requests.
 */
export type ApiVersionStrategy = 'url' | 'header' | 'query';

/**
 * A version transformer function that converts request/response data
 * between API versions.
 */
export type ApiVersionTransformer = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * One version entry consumed by apiVersion() via {@link ApiVersioningConfig}.versions
 * — not the record-history config in core/types.
 */
export interface ApiVersionConfig {
  /** Version identifier (e.g. '1', '2', '2024-01-15') */
  version: string;
  /** Optional middleware to apply for this version */
  middleware?: MiddlewareHandler[];
  /** Transform incoming request body from this version to latest */
  requestTransformer?: ApiVersionTransformer;
  /** Transform outgoing response data from latest to this version */
  responseTransformer?: ApiVersionTransformer;
  /** ISO date string when this version was deprecated */
  deprecated?: string;
  /** ISO date string when this version will be removed */
  sunset?: string;
}

/**
 * Top-level bag for the apiVersion() middleware.
 * NOT to be confused with {@link ApiVersionConfig}, which describes ONE version entry
 * inside `versions`. (Unrelated to the record-history feature's config in core/types,
 * which governs stored record versions, not HTTP API negotiation.)
 */
export interface ApiVersioningConfig {
  /** Available API versions. First is treated as default if no defaultVersion specified. */
  versions: ApiVersionConfig[];
  /** Default version when none is specified by client */
  defaultVersion?: string;
  /** Version extraction strategy. @default 'header' */
  strategy?: ApiVersionStrategy;
  /** Header name for header strategy. @default 'Accept-Version' */
  headerName?: string;
  /** Query parameter name for query strategy. @default 'version' */
  queryParam?: string;
  /** URL prefix pattern for URL strategy (e.g. '/v{version}'). @default '/v{version}' */
  urlPattern?: string;
  /** Custom version extractor (overrides strategy) */
  extractVersion?: (ctx: Context) => string | undefined;
  /** Whether to add version headers to responses. @default true */
  addHeaders?: boolean;
}

/**
 * Environment type additions for API versioning.
 *
 * Variables are typed optional because they are only set after the api-version
 * middleware has run. Use `extends ApiVersionEnv` on your app's `Env` to opt in.
 */
export interface ApiVersionEnv extends Env {
  Variables: {
    apiVersion?: string;
    apiVersionConfig?: ApiVersionConfig;
  };
}
