import type {
  MetaInput,
  IncludeOptions,
  RelationConfig,
} from '../../core/types';

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
 * Loads related records for a given item based on relation configuration.
 */
export function loadRelation<T extends Record<string, unknown>>(
  item: T,
  relationName: string,
  relationConfig: RelationConfig
): T {
  const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
  const localKey = relationConfig.localKey || 'id';
  const localValue = item[localKey];

  if (localValue === undefined || localValue === null) {
    return item;
  }

  const relatedItems = Array.from(relatedStore.values()).filter((relatedItem) => {
    return relatedItem[relationConfig.foreignKey] === localValue;
  });

  switch (relationConfig.type) {
    case 'hasOne':
      return { ...item, [relationName]: relatedItems[0] || null };
    case 'hasMany':
      return { ...item, [relationName]: relatedItems };
    case 'belongsTo': {
      // For belongsTo, the foreign key is on the current item
      const foreignValue = item[relationConfig.foreignKey];
      if (foreignValue === undefined || foreignValue === null) {
        return { ...item, [relationName]: null };
      }
      const parentItem = Array.from(relatedStore.values()).find(
        (r) => r[relationConfig.localKey || 'id'] === foreignValue
      );
      return { ...item, [relationName]: parentItem || null };
    }
    default:
      return item;
  }
}

/**
 * Loads all requested relations for an item.
 */
export function loadRelations<T extends Record<string, unknown>, M extends MetaInput>(
  item: T,
  meta: M,
  includeOptions?: IncludeOptions
): T {
  if (!includeOptions?.relations?.length || !meta.model.relations) {
    return item;
  }

  let result = { ...item } as T;

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName];
    if (relationConfig) {
      result = loadRelation(result, relationName, relationConfig);
    }
  }

  return result;
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
