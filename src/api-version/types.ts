import type { Context, MiddlewareHandler } from 'hono';

/**
 * Strategy for extracting the API version from requests.
 */
export type VersionStrategy = 'url' | 'header' | 'query';

/**
 * A version transformer function that converts request/response data
 * between API versions.
 */
export type VersionTransformer = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Configuration for a single API version.
 */
export interface ApiVersionConfig {
  /** Version identifier (e.g. '1', '2', '2024-01-15') */
  version: string;
  /** Optional middleware to apply for this version */
  middleware?: MiddlewareHandler[];
  /** Transform incoming request body from this version to latest */
  requestTransformer?: VersionTransformer;
  /** Transform outgoing response data from latest to this version */
  responseTransformer?: VersionTransformer;
  /** ISO date string when this version was deprecated */
  deprecated?: string;
  /** ISO date string when this version will be removed */
  sunset?: string;
}

/**
 * Configuration for the API versioning middleware.
 */
export interface VersioningMiddlewareConfig {
  /** Available API versions. First is treated as default if no defaultVersion specified. */
  versions: ApiVersionConfig[];
  /** Default version when none is specified by client */
  defaultVersion?: string;
  /** Version extraction strategy. @default 'header' */
  strategy?: VersionStrategy;
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
 */
export interface ApiVersionEnv {
  Variables: {
    apiVersion: string;
    apiVersionConfig: ApiVersionConfig;
  };
}
