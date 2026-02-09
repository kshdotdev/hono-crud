import type { Context, Env } from 'hono';
import type { OpenAPIRoute } from '../core/route';
import type { MetaInput } from '../core/types';
import { getLogger } from '../core/logger';
import type {
  CacheConfig,
  CacheInvalidationConfig,
  CacheStorage,
  InvalidationStrategy,
} from './types';
import { generateCacheKey, createInvalidationPattern, createRelatedPatterns } from './key-generator';
import { MemoryCacheStorage } from './storage/memory';
import { resolveCacheStorage } from '../storage/helpers';
import { createRegistryWithDefault } from '../storage/registry';

// ============================================================================
// Global Cache Storage
// ============================================================================

/**
 * Global cache storage registry.
 * Uses lazy initialization -- the default MemoryCacheStorage is only
 * created when first accessed.
 */
export const cacheStorageRegistry = createRegistryWithDefault<CacheStorage>(
  'cacheStorage',
  () => new MemoryCacheStorage()
);

/**
 * Set the global cache storage instance.
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis';
 * import { RedisCacheStorage, setCacheStorage } from 'hono-crud/cache';
 *
 * setCacheStorage(new RedisCacheStorage({
 *   client: new Redis({ url: process.env.REDIS_URL }),
 * }));
 * ```
 */
export function setCacheStorage(storage: CacheStorage): void {
  cacheStorageRegistry.set(storage);
}

/**
 * Get the global cache storage instance.
 */
export function getCacheStorage(): CacheStorage {
  return cacheStorageRegistry.getRequired();
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Constructor type for classes.
 */
type Constructor<T = object> = new (...args: unknown[]) => T;

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
  jsonWithCache<T>(data: T, status?: number): Response;
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
 * Mixin that adds caching capabilities to read/list endpoints.
 *
 * @example
 * ```ts
 * class UserRead extends withCache(MemoryReadEndpoint) {
 *   _meta = { model: UserModel };
 *
 *   cacheConfig = {
 *     ttl: 300,           // 5 minutes
 *     perUser: false,     // Shared cache
 *   };
 *
 *   async handle(ctx: Context) {
 *     this.setContext(ctx);
 *
 *     // Try cache first
 *     const cached = await this.getCachedResponse<UserData>();
 *     if (cached) {
 *       return this.success(cached);
 *     }
 *
 *     // Fetch from database
 *     const response = await super.handle(ctx);
 *
 *     // Cache the result (only if successful)
 *     if (response.status === 200) {
 *       const data = await response.clone().json();
 *       await this.setCachedResponse(data.result);
 *     }
 *
 *     return response;
 *   }
 * }
 * ```
 */
export function withCache<TBase extends Constructor<OpenAPIRoute>>(
  Base: TBase
): TBase & Constructor<CacheEndpointMethods> {
  // @ts-expect-error - TypeScript has issues with mixin patterns and protected members
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
        ttl: 300,
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
      const meta = (this as unknown as { _meta?: MetaInput })._meta;
      const tableName = meta?.model?.tableName ?? 'unknown';

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
    private _cacheHit: boolean = false;

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
      const storage = resolveCacheStorage(ctx);
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
     * Create a response with cache header included.
     */
    protected successWithCache<T>(result: T, status: number = 200): Response {
      return new Response(JSON.stringify({ success: true, result }), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': this.getCacheStatus(),
        },
      });
    }

    /**
     * Create a JSON response with cache header included.
     */
    protected jsonWithCache<T>(data: T, status: number = 200): Response {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': this.getCacheStatus(),
        },
      });
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
      const storage = resolveCacheStorage(ctx);

      // Build tags
      const tags: string[] = config.tags ? [...config.tags] : [];

      // Add model tag
      const meta = (this as unknown as { _meta?: MetaInput })._meta;
      if (meta?.model?.tableName) {
        tags.push(meta.model.tableName);
      }

      await storage.set(key, data, {
        ttl: config.ttl,
        tags: tags.length > 0 ? tags : undefined,
      });
    }

    /**
     * Manually invalidate cache entries.
     */
    async invalidateCache(options?: { pattern?: string; tags?: string[] }): Promise<void> {
      const ctx = this.getContext();
      const storage = resolveCacheStorage(ctx);
      const config = this.getCacheConfig();

      if (options?.pattern) {
        await storage.deletePattern(options.pattern);
      } else if (options?.tags && storage.deleteByTag) {
        for (const tag of options.tags) {
          await storage.deleteByTag(tag);
        }
      } else {
        // Invalidate all for this model
        const meta = (this as unknown as { _meta?: MetaInput })._meta;
        const tableName = meta?.model?.tableName ?? 'unknown';
        const pattern = createInvalidationPattern(tableName, undefined, config.prefix);
        await storage.deletePattern(pattern);
      }
    }
  }

  return CachedRoute as unknown as TBase & Constructor<CacheEndpointMethods>;
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
export function withCacheInvalidation<TBase extends Constructor<OpenAPIRoute>>(
  Base: TBase
): TBase & Constructor<CacheInvalidationMethods> {
  // @ts-expect-error - TypeScript has issues with mixin patterns and protected members
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
      const storage = resolveCacheStorage(ctx);

      const meta = (this as unknown as { _meta?: MetaInput })._meta;
      const tableName = meta?.model?.tableName ?? 'unknown';

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
      // @ts-expect-error - TypeScript can't see that Base has a concrete handle implementation
      const response = await super.handle();

      // Only invalidate on success
      if (response.status >= 200 && response.status < 300) {
        // Extract record ID from response if available
        let recordId: string | number | undefined;

        try {
          const cloned = response.clone();
          const data = await cloned.json() as { result?: { id?: string | number } };
          recordId = data?.result?.id;
        } catch {
          // Ignore parse errors
        }

        // Fire and forget invalidation with context
        const meta = (this as unknown as { _meta?: MetaInput })._meta;
        const tableName = meta?.model?.tableName ?? 'unknown';

        this.performCacheInvalidation(recordId).catch((err) => {
          getLogger().error('Cache invalidation failed', {
            error: err instanceof Error ? err.message : String(err),
            tableName,
            recordId,
          });
        });
      }

      return response;
    }
  }

  return InvalidatingRoute as unknown as TBase & Constructor<CacheInvalidationMethods>;
}

// ============================================================================
// Convenience Exports
// ============================================================================

export type { CacheConfig, CacheInvalidationConfig, InvalidationStrategy };
