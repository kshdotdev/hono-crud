import {
  type IncludeOptions,
  type ListFilters,
  type MetaInput,
  type RelatedRecord,
  type SyncRelationLoaderAdapter,
  loadRelationsForItemSync,
} from 'hono-crud/internal';
import { matchesFilter } from './filter';

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
 * Runs the shared list-query block against a per-table store: soft-delete
 * visibility (`withDeleted`/`onlyDeleted`), the `matchesFilter` filter loop,
 * the generic `?search=` substring needle, and `order_by` sorting. Shared by
 * the List and Export endpoints so the query semantics cannot drift;
 * pagination (offset slice or keyset cursor window) stays with the caller.
 *
 * The returned array's length is the query's total count.
 */
export function queryMemoryStore<T>(
  store: Map<string, T>,
  filters: ListFilters,
  searchFields: string[],
  softDeleteConfig: { enabled: boolean; field: string },
): T[] {
  let items = Array.from(store.values());

  // Apply soft delete filter
  if (softDeleteConfig.enabled) {
    if (filters.options.onlyDeleted) {
      // Show only deleted records
      items = items.filter((item) => {
        const deletedAt = (item as Record<string, unknown>)[softDeleteConfig.field];
        return deletedAt !== null && deletedAt !== undefined;
      });
    } else if (!filters.options.withDeleted) {
      // Default: exclude deleted records
      items = items.filter((item) => {
        const deletedAt = (item as Record<string, unknown>)[softDeleteConfig.field];
        return deletedAt === null || deletedAt === undefined;
      });
    }
    // If withDeleted=true, don't filter (show all)
  }

  // Apply filters
  for (const filter of filters.filters) {
    items = items.filter((item) => {
      const value = (item as Record<string, unknown>)[filter.field];
      return matchesFilter(value, filter);
    });
  }

  // Apply search (literal substring, case-insensitive — see the like/ilike
  // contract: user `%`/`_` are inert characters, never wildcards)
  if (filters.options.search && searchFields.length > 0) {
    const searchTerm = filters.options.search.toLowerCase();
    items = items.filter((item) =>
      searchFields.some((field) => {
        const value = (item as Record<string, unknown>)[field];
        return String(value).toLowerCase().includes(searchTerm);
      }),
    );
  }

  // Apply sorting
  if (filters.options.order_by) {
    const orderBy = filters.options.order_by;
    const direction = filters.options.order_by_direction === 'desc' ? -1 : 1;

    items.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[orderBy] as string | number;
      const bVal = (b as Record<string, unknown>)[orderBy] as string | number;

      if (aVal < bVal) return -1 * direction;
      if (aVal > bVal) return 1 * direction;
      return 0;
    });
  }

  return items;
}

/**
 * Finds a record in the store whose values match `data` on every upsert key.
 *
 * Soft-deleted rows are matched too: upsert-family endpoints restore them on
 * update ("match-and-restore", see core's `applyUpsertRestore`). Shared by
 * Upsert, Import, and BatchUpsert so the matching semantics cannot drift.
 */
export function findByUpsertKeys<T>(
  store: Map<string, T>,
  data: Record<string, unknown>,
  upsertKeys: string[],
): T | null {
  if (upsertKeys.length === 0) {
    return null;
  }
  for (const existing of store.values()) {
    let allMatch = true;
    for (const key of upsertKeys) {
      if (data[key] !== (existing as Record<string, unknown>)[key]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return existing;
    }
  }
  return null;
}
