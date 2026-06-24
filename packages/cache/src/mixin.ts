import type { Context, Env } from 'hono';
import type {
  AbstractConstructor,
  MetaInput,
  OpenAPIRoute,
  ResponseEnvelopeInfo,
} from 'hono-crud/internal';
import {
  CONTEXT_KEYS,
  ConfigurationException,
  createStorageFeature,
  getLogger,
} from 'hono-crud/internal';
import {
  createInvalidationPattern,
  createRelatedPatterns,
  generateCacheKey,
} from './key-generator';
import type {
  CacheConfig,
  CacheInvalidationConfig,
  CacheStorage,
  InvalidationStrategy,
} from './types';

/**
 * Read `_meta.model.tableName` off the endpoint instance and throw a clear
 * `ConfigurationException` if missing. Replaces a `?? 'unknown'` fallback
 * that silently corrupted cache keys when an endpoint forgot to declare meta.
 */
function getTableName(self: unknown): string {
  const meta = (self as { _meta?: MetaInput })._meta;
  const tableName = meta?.model?.tableName;
  if (!tableName) {
    throw new ConfigurationException(
      'Cache mixin requires `_meta.model.tableName`. Declare `_meta` on the endpoint or remove the cache mixin.',
    );
  }
  return tableName;
}

// ============================================================================
// Global Cache Storage
// ============================================================================

/**
 * Cache storage feature.
 * Nullable — no default storage is created unless explicitly set. The request
 * path uses `resolveCacheStorage` and emits a once-per-isolate warning when no
 * storage resolves (caching silently disabled is a mis-wiring worth surfacing).
 */
const cacheStorageFeature = createStorageFeature<CacheStorage>({
  contextKey: CONTEXT_KEYS.cacheStorage,
});

/**
 * Backing registry (exported for advanced use / tests).
 */
export const cacheStorageRegistry = cacheStorageFeature.registry;

/**
 * Set the global cache storage instance.
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis';
 * import { RedisCacheStorage, setCacheStorage } from '@hono-crud/cache';
 *
 * setCacheStorage(new RedisCacheStorage({
 *   client: new Redis({ url: c.env.REDIS_URL }),
 * }));
 * ```
 */
export const setCacheStorage = cacheStorageFeature.set;

/**
 * Get the explicitly-configured global cache storage, or `null` when none is
 * configured. Never throws and never creates a hidden default. Use
 * {@link getCacheStorageRequired} when a non-null storage is required.
 */
export const getCacheStorage = cacheStorageFeature.get;

/**
 * Get the global cache storage instance, throwing if not configured.
 */
export const getCacheStorageRequired = cacheStorageFeature.getRequired;

/**
 * Resolves cache storage with priority: explicit param > context > global.
 *
 * @param ctx - Optional Hono context
 * @param explicitStorage - Optional explicit storage instance
 * @returns The resolved storage, or null when no storage was configured
 */
export const resolveCacheStorage = cacheStorageFeature.resolve;

/** Once-per-isolate guard for the missing-storage warning (dedup, not request state). */
let warnedMissingCacheStorage = false;

/**
 * Resolve cache storage for the request path, emitting a once-per-isolate
 * warning when nothing resolves. Caching then degrades to a no-op — correct
 * for an optimization-only feature, but loud enough that a mis-wired app
 * (forgotten `createStorageMiddleware` / `setCacheStorage`) is observable.
 */
function resolveCacheStorageOrWarn(ctx?: Context<Env>): CacheStorage | null {
  const storage = cacheStorageFeature.resolve(ctx);
  if (!storage && !warnedMissingCacheStorage) {
    warnedMissingCacheStorage = true;
    getLogger().warn(
      'Cache storage not configured — caching is disabled. Inject cacheStorage with ' +
        'createStorageMiddleware() (recommended) or call setCacheStorage(). ' +
        'This warning is logged once per isolate.',
    );
  }
  return storage;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Interface for cacheable endpoint methods added by withCache mixin.
 */
export interface CacheEndpointMethods {
  cacheConfig?: CacheConfig;
  getCacheConfig(): CacheConfig;
  generateCacheKey(): Promise<string>;
  getCachedResponse<T>(): Promise<T | null>;
  setCachedResponse<T>(data: T): Promise<void>;
  invalidateCache(options?: { pattern?: string; tags?: string[] }): Promise<void>;
  getCacheStatus(): 'HIT' | 'MISS';
  successWithCache<T>(result: T, status?: number): Response;
  successPaginatedWithCache<T>(result: T, info: ResponseEnvelopeInfo, status?: number): Response;
}

/**
 * Subset of the base `OpenAPIRoute` body formatters the cache mixin delegates
 * to. These are `protected` on the base and invisible to the mixin through
 * the generic constructor (TS#17744), so we reach them via this cast. They
 * are the single source of truth for the response envelope — the mixin only
 * layers the `X-Cache` header on top.
 */
interface EnvelopeFormatters {
  success(result: unknown, status?: number): Response;
  successPaginated(result: unknown, info: ResponseEnvelopeInfo, status?: number): Response;
}

/**
 * Interface for cache invalidation endpoint methods.
 */
export interface CacheInvalidationMethods {
  cacheInvalidation?: CacheInvalidationConfig;
  getCacheInvalidationConfig(): CacheInvalidationConfig;
  performCacheInvalidation(recordId?: string | number): Promise<void>;
}

// ============================================================================
// withCache Mixin
// ============================================================================

/**
 * Resolve a mixin's instance type. When the caller passes an explicit `TInstance`
 * (e.g. `withCache<UserRead<AuthEnv, typeof meta>>(UserRead)`) it is preserved;
 * otherwise it falls back to the base's own `InstanceType<TBase>`. This lets a
 * GENERIC base class keep its `<Env, Meta>` type params — which `InstanceType<TBase>`
 * alone erases to the class defaults, since TS cannot pass a parametrized class as a
 * value, so a `Hono<AuthEnv>` endpoint would otherwise widen back to `Env` and fail
 * a typed `CrudEndpoints<AuthEnv>` registration.
 */
type MixinInstance<TInstance, TBase extends AbstractConstructor<OpenAPIRoute>> = [
  TInstance,
] extends [never]
  ? InstanceType<TBase>
  : TInstance;

/**
 * Mixin that adds caching capabilities to read/list endpoints.
 *
 * The route registrar calls `setContext(c)` before invoking `handle()`,
 * so overrides are parameterless — never add a `ctx` parameter or call
 * `setContext` yourself.
 *
 * @example
 * ```ts
 * class UserRead extends withCache(MemoryReadEndpoint) {
 *   _meta = userMeta;
 *
 *   cacheConfig = {
 *     ttlSeconds: 300,    // 5 minutes
 *     perUser: false,     // Shared cache
 *   };
 *
 *   override async handle(): Promise<Response> {
 *     // Try cache first
 *     const cached = await this.getCachedResponse<UserData>();
 *     if (cached) {
 *       return this.successWithCache(cached);
 *     }
 *
 *     // Fetch from database
 *     const response = await super.handle();
 *
 *     // Cache the result (only if successful)
 *     if (response.status === 200) {
 *       const data = (await response.clone().json()) as { result: UserData };
 *       await this.setCachedResponse(data.result);
 *     }
 *
 *     return response;
 *   }
 * }
 * ```
 */
export function withCache<
  // Optional explicit instance type — defaults to `never`, which preserves the
  // exact backward-compatible inference (`InstanceType<TBase>`). Pass it to keep a
  // generic base's `<Env, Meta>` params: `withCache<UserRead<AuthEnv, typeof meta>>(UserRead)`.
  // The constraint is env-agnostic (`<any>`): a non-default env like `AuthEnv` is
  // NOT assignable to `OpenAPIRoute<Env>` (Context variance), which is the very
  // widening this overload exists to prevent.
  // biome-ignore lint/suspicious/noExplicitAny: env-agnostic constraint by design.
  TInstance extends OpenAPIRoute<any> = never,
  TBase extends AbstractConstructor<OpenAPIRoute> = AbstractConstructor<OpenAPIRoute>,
>(
  Base: TBase,
  // A single construct signature (instance type intersected) — an
  // intersection of two constructor types (`TBase & Constructor<...>`)
  // cannot be extended (TS2510: base constructors must share a return
  // type), which would break `class X extends withCache(Base)`.
): AbstractConstructor<MixinInstance<TInstance, TBase> & CacheEndpointMethods> {
  // @ts-expect-error - TS mixin limitation: cannot access protected members of generic base class (TS#17744)
  class CachedRoute extends Base implements CacheEndpointMethods {
    /**
     * Cache configuration for this endpoint.
     */
    cacheConfig?: CacheConfig;

    /**
     * Get the normalized cache configuration.
     */
    getCacheConfig(): CacheConfig {
      return {
        enabled: true,
        ttlSeconds: 300,
        perUser: false,
        ...this.cacheConfig,
      };
    }

    /**
     * Generate a cache key for the current request.
     */
    async generateCacheKey(): Promise<string> {
      const config = this.getCacheConfig();
      const ctx = this.getContext();

      // Get model meta
      const tableName = getTableName(this);

      // Get validated data
      const validatedData = await this.getValidatedData();
      const params = validatedData.params as Record<string, string> | undefined;
      const query = validatedData.query as Record<string, unknown> | undefined;

      // Determine method type
      const method = params && Object.keys(params).length > 0 ? 'GET' : 'LIST';

      // Get user ID if per-user caching
      let userId: string | undefined;
      if (config.perUser) {
        const ctxWithVar = ctx as Context<Env & { Variables: { userId?: string } }>;
        userId = ctxWithVar.var?.userId;
      }

      return generateCacheKey({
        tableName,
        method,
        params,
        query,
        keyFields: config.keyFields,
        userId,
        prefix: config.prefix,
      });
    }

    /** Track whether cache was hit for the current request */
    private _cacheHit = false;

    /**
     * Get cached response data.
     * Returns null if not cached or caching is disabled.
     */
    async getCachedResponse<T>(): Promise<T | null> {
      const config = this.getCacheConfig();

      if (!config.enabled) {
        this._cacheHit = false;
        return null;
      }

      const key = await this.generateCacheKey();
      const ctx = this.getContext();
      const storage = resolveCacheStorageOrWarn(ctx);
      if (!storage) {
        this._cacheHit = false;
        return null;
      }
      const entry = await storage.get<T>(key);

      this._cacheHit = entry !== null;

      return entry?.data ?? null;
    }

    /**
     * Get cache status (HIT or MISS).
     */
    getCacheStatus(): 'HIT' | 'MISS' {
      return this._cacheHit ? 'HIT' : 'MISS';
    }

    /**
     * Create a single-item success response with the `X-Cache` header.
     *
     * Body formatting is delegated to the inherited `success()` so the
     * configured `ResponseEnvelope` is the single source of truth — the cache
     * HIT path and the MISS path (which also calls `success()` upstream) emit
     * byte-identical bodies. We only attach `X-Cache` on top.
     */
    protected successWithCache<T>(result: T, status = 200): Response {
      const response = (this as unknown as EnvelopeFormatters).success(result, status);
      response.headers.set('X-Cache', this.getCacheStatus());
      return response;
    }

    /**
     * Create a paginated/list success response with the `X-Cache` header.
     *
     * Delegates body formatting to the inherited `successPaginated()` so the
     * pagination metadata is threaded through the configured
     * `ResponseEnvelope` exactly as on a cache miss.
     */
    protected successPaginatedWithCache<T>(
      result: T,
      info: ResponseEnvelopeInfo,
      status = 200,
    ): Response {
      const response = (this as unknown as EnvelopeFormatters).successPaginated(
        result,
        info,
        status,
      );
      response.headers.set('X-Cache', this.getCacheStatus());
      return response;
    }

    /**
     * Cache the response data.
     */
    async setCachedResponse<T>(data: T): Promise<void> {
      const config = this.getCacheConfig();

      if (!config.enabled) {
        return;
      }

      const key = await this.generateCacheKey();
      const ctx = this.getContext();
      const storage = resolveCacheStorageOrWarn(ctx);
      if (!storage) {
        return;
      }

      // Build tags
      const tags: string[] = config.tags ? [...config.tags] : [];

      // Add model tag
      const meta = (this as unknown as { _meta?: MetaInput })._meta;
      if (meta?.model?.tableName) {
        tags.push(meta.model.tableName);
      }

      await storage.set(key, data, {
        ttlMs: config.ttlSeconds != null ? config.ttlSeconds * 1000 : undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
    }

    /**
     * Manually invalidate cache entries.
     */
    async invalidateCache(options?: { pattern?: string; tags?: string[] }): Promise<void> {
      const ctx = this.getContext();
      const storage = resolveCacheStorageOrWarn(ctx);
      if (!storage) {
        return;
      }
      const config = this.getCacheConfig();

      if (options?.pattern) {
        await storage.deletePattern(options.pattern);
      } else if (options?.tags && storage.deleteByTag) {
        for (const tag of options.tags) {
          await storage.deleteByTag(tag);
        }
      } else {
        // Invalidate all for this model
        const tableName = getTableName(this);
        const pattern = createInvalidationPattern(tableName, undefined, config.prefix);
        await storage.deletePattern(pattern);
      }
    }
  }

  return CachedRoute as unknown as AbstractConstructor<
    MixinInstance<TInstance, TBase> & CacheEndpointMethods
  >;
}

// ============================================================================
// withCacheInvalidation Mixin
// ============================================================================

/**
 * Mixin that adds cache invalidation to mutation endpoints.
 * Automatically invalidates relevant caches after mutations.
 *
 * @example
 * ```ts
 * class UserUpdate extends withCacheInvalidation(MemoryUpdateEndpoint) {
 *   _meta = { model: UserModel };
 *
 *   cacheInvalidation = {
 *     strategy: 'all',           // Invalidate all user caches
 *     relatedModels: ['posts'],  // Also invalidate posts cache
 *   };
 * }
 * ```
 */
export function withCacheInvalidation<
  // Optional explicit instance type (see `withCache`): pass it to preserve a
  // generic base's `<Env, Meta>` params, e.g.
  // `withCacheInvalidation<UserUpdate<AuthEnv, typeof meta>>(UserUpdate)`.
  // biome-ignore lint/suspicious/noExplicitAny: env-agnostic constraint by design.
  TInstance extends OpenAPIRoute<any> = never,
  TBase extends AbstractConstructor<OpenAPIRoute> = AbstractConstructor<OpenAPIRoute>,
>(
  Base: TBase,
  // Single construct signature — see the `withCache` return-type note.
): AbstractConstructor<MixinInstance<TInstance, TBase> & CacheInvalidationMethods> {
  // @ts-expect-error - TS mixin limitation: cannot access protected members of generic base class (TS#17744)
  class InvalidatingRoute extends Base implements CacheInvalidationMethods {
    /**
     * Cache invalidation configuration.
     */
    cacheInvalidation?: CacheInvalidationConfig;

    /**
     * Get the normalized cache invalidation configuration.
     */
    getCacheInvalidationConfig(): CacheInvalidationConfig {
      return {
        strategy: 'all',
        ...this.cacheInvalidation,
      };
    }

    /**
     * Perform cache invalidation based on configuration.
     * This is called automatically in the after() hook.
     */
    async performCacheInvalidation(recordId?: string | number): Promise<void> {
      const config = this.getCacheInvalidationConfig();
      const ctx = this.getContext();
      const storage = resolveCacheStorageOrWarn(ctx);
      if (!storage) {
        return;
      }

      const tableName = getTableName(this);

      const strategy = config.strategy ?? 'all';

      switch (strategy) {
        case 'single':
          if (recordId !== undefined) {
            const pattern = createInvalidationPattern(tableName, { id: recordId });
            await storage.deletePattern(pattern);
          }
          break;

        case 'list':
          const listPattern = createInvalidationPattern(tableName, { method: 'LIST' });
          await storage.deletePattern(listPattern);
          break;

        case 'all':
          const allPattern = createInvalidationPattern(tableName);
          await storage.deletePattern(allPattern);
          break;

        case 'pattern':
          if (config.pattern) {
            await storage.deletePattern(config.pattern);
          }
          break;

        case 'tags':
          if (config.tags && storage.deleteByTag) {
            for (const tag of config.tags) {
              await storage.deleteByTag(tag);
            }
          }
          break;
      }

      // Invalidate related models
      if (config.relatedModels && config.relatedModels.length > 0) {
        const relatedPatterns = createRelatedPatterns(tableName, config.relatedModels);
        for (const pattern of relatedPatterns) {
          await storage.deletePattern(pattern);
        }
      }
    }

    /**
     * Override handle to perform invalidation after the mutation.
     */
    async handle(): Promise<Response> {
      // @ts-expect-error - TS mixin limitation: super.handle() not visible through generic base (TS#17744)
      const response = await super.handle();

      // Only invalidate on success
      if (response.status >= 200 && response.status < 300) {
        // Extract record ID from response if available
        let recordId: string | number | undefined;

        try {
          const cloned = response.clone();
          const data = (await cloned.json()) as { result?: { id?: string | number } };
          recordId = data?.result?.id;
        } catch {
          // Ignore parse errors
        }

        // Invalidate without blocking the response, keeping contextual error logging
        const tableName = getTableName(this);

        const invalidation = this.performCacheInvalidation(recordId).catch((err) => {
          getLogger().error('Cache invalidation failed', {
            error: err instanceof Error ? err.message : String(err),
            tableName,
            recordId,
          });
        });
        // On Workers the invalidation must be registered via waitUntil or it is
        // cancelled when the response returns, leaving stale cache entries.
        this.runAfterResponse(invalidation);
      }

      return response;
    }
  }

  return InvalidatingRoute as unknown as AbstractConstructor<
    MixinInstance<TInstance, TBase> & CacheInvalidationMethods
  >;
}

// ============================================================================
// Convenience Exports
// ============================================================================

export type { CacheConfig, CacheInvalidationConfig, InvalidationStrategy };
