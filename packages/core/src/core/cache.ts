/**
 * Core-owned caching primitives.
 *
 * Caching used to live entirely in `@hono-crud/cache` (the `withCache` mixin +
 * a consumer-authored `handle()` override). To make caching reachable through
 * the CONFIG API (`defineEndpoints` / `endpoints.{list,read}.cache`), core needs
 * its own cache code path — and therefore owns the cache key format, the
 * `CacheConfig` shape, and the cache-storage feature/registry. `@hono-crud/cache`
 * re-exports all of this so there is a SINGLE storage global + ONE key format
 * shared by both the config path and the mixin.
 *
 * `CacheConfig.ttlSeconds` is seconds (ergonomic); the storage boundary
 * (`CacheSetOptions.ttlMs`) is milliseconds.
 */
import type { Context, Env } from 'hono';
import type { CacheStorage } from '../storage/contracts';
import { createStorageFeature } from '../storage/feature';
import { CONTEXT_KEYS } from './context-keys';
import { getLogger } from './logger';

// ============================================================================
// Config + key types
// ============================================================================

/** Per-endpoint cache configuration (list/read). */
export interface CacheConfig {
  /** Whether caching is enabled. @default true */
  enabled?: boolean;
  /** Time-to-live in seconds. @default 300 (5 min) */
  ttlSeconds?: number;
  /** Key prefix for cache entries. */
  prefix?: string;
  /** Query parameters to include in the cache key. */
  keyFields?: string[];
  /** Include the request `userId` var in the cache key (per-user caching). */
  perUser?: boolean;
  /** Tags for group invalidation. */
  tags?: string[];
}

/** Invalidation strategy for mutation endpoints. */
export type InvalidationStrategy =
  | 'single' // Invalidate only the modified record
  | 'list' // Invalidate only list caches
  | 'all' // Invalidate all caches for this model
  | 'pattern' // Use a custom pattern
  | 'tags'; // Invalidate by tags

/** Cache invalidation configuration for mutation endpoints. */
export interface CacheInvalidationConfig {
  /** Invalidation strategy. @default 'all' */
  strategy?: InvalidationStrategy;
  /** Custom pattern for the 'pattern' strategy. */
  pattern?: string;
  /** Tags to invalidate for the 'tags' strategy. */
  tags?: string[];
  /** Related model table names to also invalidate. */
  relatedModels?: string[];
}

/** Options for {@link generateCacheKey}. */
export interface CacheKeyOptions {
  tableName: string;
  method: 'GET' | 'LIST';
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  keyFields?: string[];
  userId?: string;
  prefix?: string;
}

/** Options for {@link createInvalidationPattern}. */
export interface InvalidationPatternOptions {
  method?: 'GET' | 'LIST';
  id?: string | number;
  userId?: string;
}

// ============================================================================
// Key generation / invalidation patterns (pure)
// ============================================================================

/**
 * Build a cache key.
 * Format: `{prefix?}:{tableName}:{method}:{pathParams?}:{queryParams?}:{user=id?}`
 */
export function generateCacheKey(options: CacheKeyOptions): string {
  const { tableName, method, params, query, keyFields, userId, prefix } = options;
  const parts: string[] = [];

  if (prefix) parts.push(prefix);
  parts.push(tableName);
  parts.push(method);

  if (params && Object.keys(params).length > 0) {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    parts.push(sortedParams);
  }

  if (query && Object.keys(query).length > 0) {
    let queryKeys = Object.keys(query).filter(
      (key) => query[key] !== undefined && query[key] !== null && query[key] !== '',
    );
    if (keyFields && keyFields.length > 0) {
      // Always keep the response-shaping params (`fields`/`include`) in the key
      // even when `keyFields` narrows the rest — otherwise two requests with
      // different field-selection / includes would collide on one cached body.
      queryKeys = queryKeys.filter(
        (key) => keyFields.includes(key) || key === 'fields' || key === 'include',
      );
    }
    if (queryKeys.length > 0) {
      const sortedQuery = queryKeys
        .sort()
        .map((key) => `${key}=${String(query[key])}`)
        .join('&');
      parts.push(sortedQuery);
    }
  }

  if (userId) parts.push(`user=${userId}`);

  return parts.join(':');
}

/**
 * Build a glob pattern for invalidating cache entries for a table.
 *
 * @example createInvalidationPattern('users') // 'users:*'
 * @example createInvalidationPattern('users', { method: 'LIST' }) // 'users:LIST*'
 * @example createInvalidationPattern('users', { id: '123' }) // 'users:*:id=123*'
 */
export function createInvalidationPattern(
  tableName: string,
  options?: InvalidationPatternOptions,
  prefix?: string,
): string {
  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  parts.push(tableName);

  if (!options) {
    parts.push('*');
    return parts.join(':');
  }

  const { method, id, userId } = options;
  if (method) {
    parts.push(method);
    return parts.join(':') + '*';
  } else if (id !== undefined) {
    parts.push('*');
    parts.push(`id=${id}*`);
  } else if (userId) {
    parts.push('*');
    parts.push(`user=${userId}`);
  } else {
    parts.push('*');
  }
  return parts.join(':');
}

/** Patterns for invalidating related models. */
export function createRelatedPatterns(
  _tableName: string,
  relatedModels: string[],
  prefix?: string,
): string[] {
  return relatedModels.map((model) => createInvalidationPattern(model, undefined, prefix));
}

/** Glob match (`*` wildcard) used by in-memory `deletePattern` backends. */
export function matchesPattern(key: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${regexPattern}$`).test(key);
}

// ============================================================================
// Cache storage feature (single global + context resolution)
// ============================================================================

/**
 * Cache storage feature. Nullable — no default is created. The request path
 * resolves explicit > context > global and emits a once-per-isolate warning
 * when nothing resolves (caching then degrades to a no-op).
 */
const cacheStorageFeature = createStorageFeature<CacheStorage>({
  contextKey: CONTEXT_KEYS.cacheStorage,
});

/** Backing registry (exported for advanced use / tests). */
export const cacheStorageRegistry = cacheStorageFeature.registry;

/** Set the global cache storage instance. */
export const setCacheStorage = cacheStorageFeature.set;

/** Get the explicitly-configured global cache storage, or `null`. Never throws. */
export const getCacheStorage = cacheStorageFeature.get;

/** Get the global cache storage, throwing if unset. */
export const getCacheStorageRequired = cacheStorageFeature.getRequired;

/** Resolve cache storage: explicit > context > global. `null` when none. */
export const resolveCacheStorage = cacheStorageFeature.resolve;

/** Once-per-isolate guard for the missing-storage warning. */
let warnedMissingCacheStorage = false;

/**
 * Resolve cache storage for the request path, warning once per isolate when
 * nothing resolves. Caching then degrades to a no-op — correct for an
 * optimization-only feature, but loud enough that a mis-wired app (forgotten
 * `createStorageMiddleware` / `setCacheStorage`) is observable.
 */
export function resolveCacheStorageOrWarn(ctx?: Context<Env>): CacheStorage | null {
  const storage = cacheStorageFeature.resolve(ctx);
  if (!storage && !warnedMissingCacheStorage) {
    warnedMissingCacheStorage = true;
    getLogger().warn(
      'Cache storage not configured — caching is disabled. Inject cacheStorage with ' +
        'createStorageMiddleware()/createCacheStorageMiddleware() (recommended) or call ' +
        'setCacheStorage(). This warning is logged once per isolate.',
    );
  }
  return storage;
}

/** @internal test seam — reset the once-per-isolate warning guard. */
export function __resetCacheStorageWarning(): void {
  warnedMissingCacheStorage = false;
}

/** Once-per-isolate guard for the policy-skip warning. */
let warnedCacheSkippedForPolicy = false;

/**
 * Warn once when config-caching is disabled because user-scoped read policies
 * are present without `cachePerUser` — a tenant-only key would otherwise serve
 * one user's authorized view to another.
 */
export function warnCacheSkippedForPolicy(): void {
  if (warnedCacheSkippedForPolicy) return;
  warnedCacheSkippedForPolicy = true;
  getLogger().warn(
    'Response caching is disabled for an endpoint with user-scoped read policies ' +
      '(read / fields / readPushdown) because the cache key is not per-user. Set ' +
      '`cache.perUser: true` to fold the userId into the key and re-enable caching. ' +
      'This warning is logged once per isolate.',
  );
}

// ============================================================================
// Endpoint runtime helpers (config-driven cache path)
// ============================================================================

/** What an endpoint exposes for the cache helpers to read its config + request. */
export interface CacheableEndpoint {
  getContext(): Context<Env>;
  getValidatedData(): Promise<{
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  }>;
  _meta?: { model?: { tableName?: string } };
  cacheEnabled: boolean;
  cacheTtlSeconds?: number;
  cacheKeyFields?: string[];
  cachePerUser?: boolean;
  cachePrefix?: string;
  cacheTags?: string[];
}

/** What to invalidate after a mutation. */
export type CacheInvalidateInput =
  | boolean
  | Array<'list' | 'read' | 'all'>
  | CacheInvalidationConfig;

/** Mutation endpoint surface for invalidation. */
export interface InvalidatingEndpoint {
  getContext(): Context<Env>;
  _meta?: { model?: { tableName?: string } };
  cacheInvalidate?: CacheInvalidateInput;
  cachePrefix?: string;
}

/**
 * Effective key prefix. The resolved tenant id (for multiTenant resources) is
 * ALWAYS folded into the prefix so a tenant's cached list/read can never be
 * served to another tenant — config-cache is safe-by-default on owner-scoped
 * resources without the consumer remembering `perUser`. Invalidation builds
 * patterns from the same effective prefix, so a mutation only clears the
 * mutating tenant's entries.
 */
function effectiveCachePrefix(
  prefix: string | undefined,
  tenantId: string | undefined,
): string | undefined {
  const parts = [prefix, tenantId != null ? `t=${tenantId}` : undefined].filter(
    (p): p is string => !!p,
  );
  return parts.length > 0 ? parts.join(':') : undefined;
}

/**
 * Cache key for the current request, or `null` when the model has no table
 * name (cannot scope a key safely → skip caching).
 */
async function buildCacheKey(ep: CacheableEndpoint, tenantId?: string): Promise<string | null> {
  const tableName = ep._meta?.model?.tableName;
  if (!tableName) return null;

  const data = await ep.getValidatedData();
  const params = data.params as Record<string, string> | undefined;
  const query = data.query as Record<string, unknown> | undefined;
  const method = params && Object.keys(params).length > 0 ? 'GET' : 'LIST';

  let userId: string | undefined;
  if (ep.cachePerUser) {
    const ctx = ep.getContext() as Context<Env & { Variables: { userId?: string } }>;
    userId = ctx.var?.userId;
  }

  return generateCacheKey({
    tableName,
    method,
    params,
    query,
    keyFields: ep.cacheKeyFields,
    userId,
    prefix: effectiveCachePrefix(ep.cachePrefix, tenantId),
  });
}

/** Read the cached payload for this request, or `null` on miss / no storage. */
export async function readEndpointCache<T>(
  ep: CacheableEndpoint,
  tenantId?: string,
): Promise<T | null> {
  const key = await buildCacheKey(ep, tenantId);
  if (!key) return null;
  const storage = resolveCacheStorageOrWarn(ep.getContext());
  if (!storage) return null;
  const entry = await storage.get<T>(key);
  return entry?.data ?? null;
}

/** Store the payload for this request under its cache key (best-effort). */
export async function writeEndpointCache<T>(
  ep: CacheableEndpoint,
  data: T,
  tenantId?: string,
): Promise<void> {
  const key = await buildCacheKey(ep, tenantId);
  if (!key) return;
  const storage = resolveCacheStorageOrWarn(ep.getContext());
  if (!storage) return;

  const tags: string[] = ep.cacheTags ? [...ep.cacheTags] : [];
  const tableName = ep._meta?.model?.tableName;
  // Tenant-scope the auto model tag so tag-based invalidation can't cross
  // tenants (the bare table tag would clear every tenant's entries).
  if (tableName) tags.push(tenantId != null ? `${tableName}:t=${tenantId}` : tableName);

  await storage.set(key, data, {
    ttlMs: ep.cacheTtlSeconds != null ? ep.cacheTtlSeconds * 1000 : undefined,
    tags: tags.length > 0 ? tags : undefined,
  });
}

/**
 * Invalidate caches after a successful mutation, per the endpoint's
 * `cacheInvalidate` config. Best-effort: no storage → no-op.
 *
 * - `true` / `['all']` → delete every cache entry for the model's table
 * - `['list']` / `['read']` → delete only LIST / GET caches for the table
 * - `CacheInvalidationConfig` → tags (`deleteByTag`), custom `pattern`,
 *   `relatedModels`, or `strategy` ('all' | 'list' | 'single')
 *
 * `single` (record-scoped) collapses to the table-wide pattern here because the
 * mutation's record id is not threaded into this helper; table-wide is the
 * safe superset (never serves stale data).
 */
export async function invalidateEndpointCache(
  ep: InvalidatingEndpoint,
  tenantId?: string,
): Promise<void> {
  const inv = ep.cacheInvalidate;
  if (!inv) return;

  const storage = resolveCacheStorageOrWarn(ep.getContext());
  if (!storage) return;

  const tableName = ep._meta?.model?.tableName;
  if (!tableName) return;

  // Same effective prefix used by read/write, so a mutation only clears the
  // mutating tenant's entries (cross-tenant caches are namespaced apart).
  const prefix = effectiveCachePrefix(ep.cachePrefix, tenantId);
  const patterns = new Set<string>();
  const tagsToDelete = new Set<string>();

  if (inv === true) {
    patterns.add(createInvalidationPattern(tableName, undefined, prefix));
  } else if (Array.isArray(inv)) {
    for (const op of inv) {
      if (op === 'all') patterns.add(createInvalidationPattern(tableName, undefined, prefix));
      else if (op === 'list')
        patterns.add(createInvalidationPattern(tableName, { method: 'LIST' }, prefix));
      else if (op === 'read')
        patterns.add(createInvalidationPattern(tableName, { method: 'GET' }, prefix));
    }
  } else {
    const config = inv as CacheInvalidationConfig;
    if (config.pattern) patterns.add(config.pattern);
    if (config.tags) for (const t of config.tags) tagsToDelete.add(t);
    // Match the tenant-scoped auto model tag written by writeEndpointCache.
    if (config.strategy === 'tags') {
      tagsToDelete.add(tenantId != null ? `${tableName}:t=${tenantId}` : tableName);
    }
    if (config.relatedModels) {
      for (const p of createRelatedPatterns(tableName, config.relatedModels, prefix)) {
        patterns.add(p);
      }
    }
    // strategy-driven patterns (default 'all' when nothing else was specified)
    const strategy = config.strategy ?? (config.pattern || config.tags ? undefined : 'all');
    if (strategy === 'all' || strategy === 'single') {
      patterns.add(createInvalidationPattern(tableName, undefined, prefix));
    } else if (strategy === 'list') {
      patterns.add(createInvalidationPattern(tableName, { method: 'LIST' }, prefix));
    }
  }

  // Best-effort: the mutation already succeeded, so a cache-store error must
  // never fail the response. Worst case is a stale entry until its TTL.
  try {
    if (tagsToDelete.size > 0 && storage.deleteByTag) {
      for (const tag of tagsToDelete) await storage.deleteByTag(tag);
    }
    for (const pattern of patterns) await storage.deletePattern(pattern);
  } catch (error) {
    getLogger().warn('Cache invalidation failed after mutation (entries will expire by TTL).', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
