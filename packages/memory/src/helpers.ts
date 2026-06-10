import {
  type IncludeOptions,
  type MetaInput,
  type RelatedRecord,
  type SyncRelationLoaderAdapter,
  loadRelationsForItemSync,
} from 'hono-crud/internal';

/**
 * Module-level in-memory storage.
 *
 * **Edge runtime warning:** On platforms like Cloudflare Workers each isolate
 * gets its own copy of module-level state. Data stored here is **not** shared
 * across isolates and will be lost when the isolate is evicted. Use a
 * persistent backing store (e.g. KV, D1, or an external database) for
 * production edge deployments.
 */
export const storage = new Map<string, Map<string, unknown>>();

/**
 * Returns the per-table Map for the given table name, creating it lazily.
 *
 * See the `storage` Map above for edge-runtime caveats.
 */
export function getStore<T>(tableName: string): Map<string, T> {
  if (!storage.has(tableName)) {
    storage.set(tableName, new Map());
  }
  return storage.get(tableName) as Map<string, T>;
}

/**
 * Builds the synchronous relation-loader adapter backing the in-memory store.
 *
 * The handle is the backing per-table Map; `resolveRelation` never returns
 * `null` because `getStore` always creates the table lazily (memory never skips
 * a relation). `fetchRelated` filters the store's records by the requested key.
 */
function memoryRelationAdapter(): SyncRelationLoaderAdapter<Map<string, RelatedRecord>> {
  return {
    resolveRelation: (config) => getStore<RelatedRecord>(config.model),
    fetchRelated: (store, keyField, values) =>
      Array.from(store.values()).filter((r) => values.includes(r[keyField])),
  };
}

/**
 * Loads all requested relations for an item.
 *
 * Delegates to the core synchronous orchestrator so the single-item read path
 * always sets the relation key (hasOne/belongsTo → record-or-null, hasMany →
 * array), gating belongsTo on `item[foreignKey]` and hasOne/hasMany on
 * `item[localKey]`.
 */
export function loadRelations<T extends Record<string, unknown>, M extends MetaInput>(
  item: T,
  meta: M,
  includeOptions?: IncludeOptions,
): T {
  return loadRelationsForItemSync(item, meta, memoryRelationAdapter(), includeOptions);
}

/**
 * Clears all in-memory storage. Useful for testing.
 */
export function clearStorage(): void {
  storage.clear();
}

/**
 * Gets the storage for a specific table. Useful for testing.
 */
export function getStorage<T>(tableName: string): Map<string, T> {
  return getStore<T>(tableName);
}
