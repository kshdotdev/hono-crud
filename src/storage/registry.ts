import type { Context, Env } from 'hono';
import { getContextVar } from '../core/context-helpers';

/**
 * Generic storage registry that manages global storage instances.
 * Eliminates duplicate global storage patterns across the codebase.
 *
 * Supports two modes:
 * 1. Nullable storage - returns null if not set (e.g., rate limit, logging)
 * 2. Storage with defaults - always returns a storage instance (e.g., cache, audit)
 *
 * @example
 * ```ts
 * // Nullable storage (no default)
 * const rateLimitRegistry = new StorageRegistry<RateLimitStorage>('rateLimitStorage');
 * rateLimitRegistry.set(new MemoryRateLimitStorage());
 * const storage = rateLimitRegistry.get(); // RateLimitStorage | null
 *
 * // Storage with default
 * const cacheRegistry = new StorageRegistry<CacheStorage>(
 *   'cacheStorage',
 *   () => new MemoryCacheStorage()
 * );
 * const storage = cacheRegistry.get(); // Always returns CacheStorage
 * ```
 */
export class StorageRegistry<T> {
  private globalStorage: T | null = null;
  private readonly contextKey: string;
  private readonly defaultFactory: (() => T) | null;
  private defaultInitialized = false;

  /**
   * Creates a new storage registry.
   *
   * @param contextKey - The key used to store/retrieve from Hono context
   * @param defaultFactory - Optional factory function to create default storage.
   *   Invoked lazily on first access, not at construction time, to avoid
   *   wasting cold-start time and memory for unused features.
   */
  constructor(contextKey: string, defaultFactory?: () => T) {
    this.contextKey = contextKey;
    this.defaultFactory = defaultFactory ?? null;
  }

  /**
   * Ensures the default storage is initialized (lazy).
   * Called internally before any read access.
   */
  private ensureDefault(): void {
    if (!this.defaultInitialized && this.defaultFactory && this.globalStorage === null) {
      this.globalStorage = this.defaultFactory();
      this.defaultInitialized = true;
    }
  }

  /**
   * Sets the global storage instance.
   */
  set(storage: T): void {
    this.globalStorage = storage;
  }

  /**
   * Gets the global storage instance.
   * Returns null if not set and no default factory was provided.
   */
  get(): T | null {
    this.ensureDefault();
    return this.globalStorage;
  }

  /**
   * Gets the global storage instance, throwing if not set.
   * Use this when storage is required.
   *
   * @throws Error if storage is not configured
   */
  getRequired(): T {
    this.ensureDefault();
    if (this.globalStorage === null) {
      throw new Error(`Storage not configured for '${this.contextKey}'`);
    }
    return this.globalStorage;
  }

  /**
   * Resolves storage with priority: explicit param > context > global.
   * This is the primary method for middleware and endpoints to get storage.
   *
   * @param ctx - Optional Hono context for context-based resolution
   * @param explicit - Optional explicitly provided storage instance
   * @returns The resolved storage or null if none available
   *
   * @example
   * ```ts
   * // In middleware
   * const storage = registry.resolve(ctx, config.storage);
   * if (!storage) {
   *   console.warn('Storage not configured');
   *   return next();
   * }
   * ```
   */
  resolve<E extends Env>(ctx?: Context<E>, explicit?: T): T | null {
    // Priority 1: Explicit parameter
    if (explicit) {
      return explicit;
    }

    // Priority 2: Context variable
    if (ctx) {
      const ctxStorage = getContextVar<T>(ctx, this.contextKey);
      if (ctxStorage) {
        return ctxStorage;
      }
    }

    // Priority 3: Global storage
    this.ensureDefault();
    return this.globalStorage;
  }

  /**
   * Resolves storage with priority, throwing if not found.
   * Use this when storage is required.
   *
   * @param ctx - Optional Hono context for context-based resolution
   * @param explicit - Optional explicitly provided storage instance
   * @returns The resolved storage
   * @throws Error if no storage is configured
   */
  resolveRequired<E extends Env>(ctx?: Context<E>, explicit?: T): T {
    const storage = this.resolve(ctx, explicit);
    if (storage === null) {
      throw new Error(`Storage not configured for '${this.contextKey}'`);
    }
    return storage;
  }

  /**
   * Resets the registry to its initial state.
   * If a default factory was provided, reinitializes with the default.
   * Useful for testing.
   */
  reset(): void {
    this.defaultInitialized = false;
    this.globalStorage = null;
  }

  /**
   * Gets the context key used by this registry.
   */
  getContextKey(): string {
    return this.contextKey;
  }

  /**
   * Checks if a storage instance is currently set.
   */
  isConfigured(): boolean {
    this.ensureDefault();
    return this.globalStorage !== null;
  }
}

/**
 * Creates a storage registry for nullable storage (no default).
 * The get() method returns T | null.
 *
 * @param contextKey - The key used to store/retrieve from Hono context
 * @returns A new StorageRegistry instance
 *
 * @example
 * ```ts
 * const rateLimitRegistry = createNullableRegistry<RateLimitStorage>('rateLimitStorage');
 * ```
 */
export function createNullableRegistry<T>(contextKey: string): StorageRegistry<T> {
  return new StorageRegistry<T>(contextKey);
}

/**
 * Creates a storage registry with a default storage instance.
 * The get() method always returns T (never null after initialization).
 *
 * @param contextKey - The key used to store/retrieve from Hono context
 * @param defaultFactory - Factory function to create default storage
 * @returns A new StorageRegistry instance with default storage
 *
 * @example
 * ```ts
 * const cacheRegistry = createRegistryWithDefault<CacheStorage>(
 *   'cacheStorage',
 *   () => new MemoryCacheStorage()
 * );
 * ```
 */
export function createRegistryWithDefault<T>(
  contextKey: string,
  defaultFactory: () => T
): StorageRegistry<T> {
  return new StorageRegistry<T>(contextKey, defaultFactory);
}
