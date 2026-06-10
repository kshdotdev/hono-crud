import type { Context, Env } from 'hono';
import { StorageRegistry } from './registry';

/**
 * The set/get/getRequired/resolve quartet every first-party storage feature
 * exposes. `getX(): T | null` returns only explicitly-configured storage and
 * never throws; `getXRequired(): T` throws (or lazy-creates a default when one
 * was configured AND lazyDefaultOnGet is set). `resolveX` applies the
 * explicit > context > global priority chain and NEVER creates a default.
 */
export interface StorageFeature<T> {
  /** The backing registry (exported for advanced use / tests). */
  registry: StorageRegistry<T>;
  /** Set the global storage instance. */
  set(storage: T): void;
  /**
   * Get the explicitly-configured global storage, or null. Never throws.
   * When the feature was created with `lazyDefaultOnGet: true`, this may
   * lazy-create the default (legacy never-null path; cache only).
   */
  get(): T | null;
  /**
   * Get the global storage, throwing if unset. When a defaultFactory was
   * configured, lazy-creates and returns the default (never throws).
   */
  getRequired(): T;
  /** Resolve with priority explicit > context > global. Returns null if none. */
  resolve<E extends Env>(ctx?: Context<E>, explicit?: T): T | null;
  /** Resolve with priority, throwing if none. */
  resolveRequired<E extends Env>(ctx?: Context<E>, explicit?: T): T;
}

export interface StorageFeatureOptions<T> {
  /** Context-var key (must equal a CONTEXT_KEYS value). */
  contextKey: string;
  /**
   * Optional lazy default factory. When provided, `getRequired()` materializes
   * the default on first access. `resolve*` still never creates hidden state
   * (edge-safe).
   */
  defaultFactory?: () => T;
  /**
   * When true (and a defaultFactory exists), `get()` ALSO lazy-creates the
   * default, preserving a legacy never-null getter. When false/omitted, `get()`
   * returns only explicitly-configured storage (honest `T | null`). Default: false.
   * Only cache sets this true; audit/versioning leave it false.
   */
  lazyDefaultOnGet?: boolean;
}

export function createStorageFeature<T>(options: StorageFeatureOptions<T>): StorageFeature<T> {
  const registry = new StorageRegistry<T>(options.contextKey, options.defaultFactory);
  const lazyOnGet = options.lazyDefaultOnGet === true && options.defaultFactory != null;
  return {
    registry,
    set: (storage) => registry.set(storage),
    // lazyOnGet → registry.get() (ensureDefault, never null when factory set).
    // else      → registry.getConfigured() (NO ensureDefault; honest null).
    get: () => (lazyOnGet ? registry.get() : registry.getConfigured()),
    getRequired: () => registry.getRequired(),
    resolve: (ctx, explicit) => registry.resolve(ctx, explicit),
    resolveRequired: (ctx, explicit) => registry.resolveRequired(ctx, explicit),
  };
}
