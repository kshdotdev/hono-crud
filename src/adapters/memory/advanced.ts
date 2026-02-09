import type { Env } from 'hono';
import { CloneEndpoint } from '../../endpoints/clone';
import { UpsertEndpoint } from '../../endpoints/upsert';
import {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from '../../endpoints/version-history';
import { AggregateEndpoint, computeAggregations } from '../../endpoints/aggregate';
import { SearchEndpoint, searchInMemory } from '../../endpoints/search';
import { ExportEndpoint } from '../../endpoints/export';
import { ImportEndpoint } from '../../endpoints/import';
import { BulkPatchEndpoint } from '../../endpoints/bulk-patch';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  IncludeOptions,
  RelationConfig,
  NestedUpdateInput,
  NestedWriteResult,
  AggregateOptions,
  AggregateResult,
  SearchOptions,
  SearchResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { getStore, loadRelations } from './helpers';

/**
 * Memory-based Clone endpoint for testing.
 * Duplicates a record with optional overrides.
 */
export abstract class MemoryCloneEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CloneEndpoint<E, M> {
  /**
   * Generates a unique ID for the cloned record.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  async findSource(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) return null;

    // Skip soft-deleted records
    if (softDeleteConfig.enabled) {
      const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt !== null && deletedAt !== undefined) {
        return null;
      }
    }

    // Check additional filters
    if (additionalFilters) {
      for (const [key, value] of Object.entries(additionalFilters)) {
        if (String((existing as Record<string, unknown>)[key]) !== value) {
          return null;
        }
      }
    }

    return existing;
  }

  async createClone(
    data: ModelObject<M['model']>
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const pk = this._meta.model.primaryKeys[0];
    const id = this.generateId();

    const record = {
      ...data,
      [pk]: id,
    } as ModelObject<M['model']>;

    store.set(id, record);
    return record;
  }
}

/**
 * Memory-based Upsert endpoint for testing.
 * Creates a record if it doesn't exist, updates it if it does.
 */
export abstract class MemoryUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpsertEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Finds an existing record by upsert keys.
   */
  async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const upsertKeys = this.getUpsertKeys();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Search for matching record
    for (const existing of store.values()) {
      // Check soft delete
      if (softDeleteConfig.enabled) {
        const deletedValue = (existing as Record<string, unknown>)[softDeleteConfig.field];
        if (deletedValue !== null && deletedValue !== undefined) {
          continue; // Skip soft-deleted records
        }
      }

      // Check if all upsert keys match
      let allMatch = true;
      for (const key of upsertKeys) {
        const dataValue = (data as Record<string, unknown>)[key];
        const existingValue = (existing as Record<string, unknown>)[key];
        if (dataValue !== existingValue) {
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

  /**
   * Creates a new record.
   */
  async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate ID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || this.generateId(),
    } as ModelObject<M['model']>;

    store.set(String((record as Record<string, unknown>)[primaryKey]), record);
    return record;
  }

  /**
   * Updates an existing record.
   */
  async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const id = String((existing as Record<string, unknown>)[primaryKey]);

    // Merge existing with new data
    const updated = {
      ...existing,
      ...data,
    } as ModelObject<M['model']>;

    store.set(id, updated);
    return updated;
  }

  /**
   * Performs a native upsert operation.
   * For in-memory storage, this is implemented as an atomic find-and-update/create.
   *
   * Note: Unlike database native upsert, this can accurately determine if the record
   * was created or updated.
   */
  protected async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Search for matching record
    let existingRecord: ModelObject<M['model']> | null = null;
    for (const existing of store.values()) {
      // Check soft delete
      if (softDeleteConfig.enabled) {
        const deletedValue = (existing as Record<string, unknown>)[softDeleteConfig.field];
        if (deletedValue !== null && deletedValue !== undefined) {
          continue;
        }
      }

      // Check if all upsert keys match
      let allMatch = true;
      for (const key of upsertKeys) {
        const dataValue = (data as Record<string, unknown>)[key];
        const existingValue = (existing as Record<string, unknown>)[key];
        if (dataValue !== existingValue) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        existingRecord = existing;
        break;
      }
    }

    if (existingRecord) {
      // Update existing record - filter out create-only fields
      let updateData = { ...data };
      if (this.createOnlyFields) {
        for (const field of this.createOnlyFields) {
          delete updateData[field as keyof typeof updateData];
        }
      }

      const id = String((existingRecord as Record<string, unknown>)[primaryKey]);
      const updated = {
        ...existingRecord,
        ...updateData,
      } as ModelObject<M['model']>;

      store.set(id, updated);
      return { data: updated, created: false };
    } else {
      // Create new record - filter out update-only fields
      let createData = { ...data };
      if (this.updateOnlyFields) {
        for (const field of this.updateOnlyFields) {
          delete createData[field as keyof typeof createData];
        }
      }

      const record = {
        ...createData,
        [primaryKey]: (data as Record<string, unknown>)[primaryKey] || this.generateId(),
      } as ModelObject<M['model']>;

      const id = String((record as Record<string, unknown>)[primaryKey]);
      store.set(id, record);
      return { data: record, created: true };
    }
  }

  /**
   * Processes nested write operations.
   */
  protected async processNestedWrites(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput
  ): Promise<NestedWriteResult> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    const result: NestedWriteResult = {
      created: [],
      updated: [],
      deleted: [],
      connected: [],
      disconnected: [],
    };

    // Process create operations
    if (operations.create) {
      const items = Array.isArray(operations.create) ? operations.create : [operations.create];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const record = {
          ...item,
          id: crypto.randomUUID(),
          [relationConfig.foreignKey]: parentId,
        };
        relatedStore.set(record.id, record);
        result.created.push(record);
      }
    }

    // Process update operations
    if (operations.update) {
      for (const item of operations.update) {
        const id = String(item.id);
        const existing = relatedStore.get(id);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          const updated = { ...existing, ...item };
          relatedStore.set(id, updated);
          result.updated.push(updated);
        }
      }
    }

    // Process delete operations
    if (operations.delete) {
      for (const id of operations.delete) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          relatedStore.delete(idStr);
          result.deleted.push(id);
        }
      }
    }

    // Process connect operations
    if (operations.connect) {
      for (const id of operations.connect) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing) {
          const connected = { ...existing, [relationConfig.foreignKey]: parentId };
          relatedStore.set(idStr, connected);
          result.connected.push(id);
        }
      }
    }

    // Process disconnect operations
    if (operations.disconnect) {
      for (const id of operations.disconnect) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          const disconnected = { ...existing, [relationConfig.foreignKey]: null };
          relatedStore.set(idStr, disconnected);
          result.disconnected.push(id);
        }
      }
    }

    return result;
  }
}

/**
 * Memory-based Version History endpoint for testing.
 * Lists all versions for a record.
 */
export abstract class MemoryVersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionHistoryEndpoint<E, M> {
  /**
   * Checks if the parent record exists.
   */
  protected async recordExists(lookupValue: string): Promise<boolean> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    return store.has(lookupValue);
  }
}

/**
 * Memory-based Version Read endpoint for testing.
 * Gets a specific version of a record.
 */
export abstract class MemoryVersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionReadEndpoint<E, M> {}

/**
 * Memory-based Version Compare endpoint for testing.
 * Compares two versions of a record.
 */
export abstract class MemoryVersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionCompareEndpoint<E, M> {}

/**
 * Memory-based Version Rollback endpoint for testing.
 * Rolls back a record to a previous version.
 */
export abstract class MemoryVersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionRollbackEndpoint<E, M> {
  /**
   * Rolls back the record to the specified version data.
   */
  async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const versionField = this.getVersioningConfig().field;

    // Create updated record with version data and new version number
    const updated = {
      ...versionData,
      [versionField]: newVersion,
    } as ModelObject<M['model']>;

    store.set(lookupValue, updated);
    return updated;
  }
}

/**
 * Memory-based Aggregate endpoint for testing.
 * Computes aggregations (COUNT, SUM, AVG, MIN, MAX) with GROUP BY support.
 */
export abstract class MemoryAggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends AggregateEndpoint<E, M> {
  /**
   * Performs aggregation on in-memory data.
   */
  async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let records = Array.from(store.values()) as Record<string, unknown>[];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter (default: exclude deleted)
    if (softDeleteConfig.enabled) {
      const { query } = await this.getValidatedData();
      const withDeleted = query?.withDeleted === true || query?.withDeleted === 'true';

      if (!withDeleted) {
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt === null || deletedAt === undefined;
        });
      }
    }

    // Apply filters
    if (options.filters) {
      for (const [field, value] of Object.entries(options.filters)) {
        records = records.filter((record) => {
          // Handle operator syntax: field[op]=value
          if (typeof value === 'object' && value !== null) {
            for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
              const recordValue = record[field];
              switch (op) {
                case 'eq':
                  return String(recordValue) === String(opValue);
                case 'ne':
                  return String(recordValue) !== String(opValue);
                case 'gt':
                  return Number(recordValue) > Number(opValue);
                case 'gte':
                  return Number(recordValue) >= Number(opValue);
                case 'lt':
                  return Number(recordValue) < Number(opValue);
                case 'lte':
                  return Number(recordValue) <= Number(opValue);
                case 'in':
                  return (opValue as unknown[]).map(String).includes(String(recordValue));
                default:
                  return true;
              }
            }
            return true;
          }
          // Simple equality
          return String(record[field]) === String(value);
        });
      }
    }

    // Use the helper function to compute aggregations
    return computeAggregations(records, options);
  }
}

/**
 * Memory-based Search endpoint for testing.
 * Provides full-text search with relevance scoring and highlighting.
 *
 * Features:
 * - TF-IDF-like relevance scoring
 * - Configurable field weights
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact)
 * - Highlighted snippets
 * - Combined with standard list filters
 *
 * @example
 * ```ts
 * class UserSearch extends MemorySearchEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Search users' };
 *
 *   protected searchFields = ['name', 'email', 'bio'];
 *   protected fieldWeights = { name: 2.0, bio: 1.0 };
 *   protected filterFields = ['status', 'role'];
 * }
 * ```
 */
export abstract class MemorySearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  /**
   * Performs search on in-memory data.
   */
  async search(
    options: SearchOptions,
    filters: ListFilters
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let records = Array.from(store.values()) as Record<string, unknown>[];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter
    if (softDeleteConfig.enabled) {
      if (filters.options.onlyDeleted) {
        // Show only deleted records
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt !== null && deletedAt !== undefined;
        });
      } else if (!filters.options.withDeleted) {
        // Default: exclude deleted records
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt === null || deletedAt === undefined;
        });
      }
    }

    // Apply filters
    for (const filter of filters.filters) {
      records = records.filter((record) => {
        const value = record[filter.field];

        switch (filter.operator) {
          case 'eq':
            return String(value) === String(filter.value);
          case 'ne':
            return String(value) !== String(filter.value);
          case 'gt':
            return Number(value) > Number(filter.value);
          case 'gte':
            return Number(value) >= Number(filter.value);
          case 'lt':
            return Number(value) < Number(filter.value);
          case 'lte':
            return Number(value) <= Number(filter.value);
          case 'in':
            return (filter.value as unknown[]).map(String).includes(String(value));
          case 'nin':
            return !(filter.value as unknown[]).map(String).includes(String(value));
          case 'like':
            return String(value).includes(String(filter.value).replace(/%/g, ''));
          case 'ilike':
            return String(value)
              .toLowerCase()
              .includes(String(filter.value).replace(/%/g, '').toLowerCase());
          case 'null':
            return filter.value ? value === null : value !== null;
          case 'between': {
            const [min, max] = filter.value as [unknown, unknown];
            return Number(value) >= Number(min) && Number(value) <= Number(max);
          }
          default:
            return true;
        }
      });
    }

    // Perform search and scoring
    const searchableFields = this.getSearchableFields();
    const searchResults = searchInMemory(
      records as ModelObject<M['model']>[],
      options,
      searchableFields
    );

    const totalCount = searchResults.length;

    // Apply sorting (by score by default, or by specified field)
    if (filters.options.order_by) {
      const orderBy = filters.options.order_by;
      const direction = filters.options.order_by_direction === 'desc' ? -1 : 1;

      searchResults.sort((a, b) => {
        const aVal = (a.item as Record<string, unknown>)[orderBy] as string | number;
        const bVal = (b.item as Record<string, unknown>)[orderBy] as string | number;

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }
    // Note: searchInMemory already sorts by score if no order_by

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const start = (page - 1) * perPage;
    const paginatedResults = searchResults.slice(start, start + perPage);

    // Load relations if requested
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const resultsWithRelations = paginatedResults.map((result) => ({
      ...result,
      item: loadRelations(result.item as Record<string, unknown>, this._meta, includeOptions) as ModelObject<M['model']>,
    }));

    return {
      items: resultsWithRelations,
      totalCount,
    };
  }
}

/**
 * Memory-based Export endpoint for testing.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class MemoryExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let items = Array.from(store.values());
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter
    if (softDeleteConfig.enabled) {
      if (filters.options.onlyDeleted) {
        items = items.filter((item) => {
          const deletedAt = (item as Record<string, unknown>)[softDeleteConfig.field];
          return deletedAt !== null && deletedAt !== undefined;
        });
      } else if (!filters.options.withDeleted) {
        items = items.filter((item) => {
          const deletedAt = (item as Record<string, unknown>)[softDeleteConfig.field];
          return deletedAt === null || deletedAt === undefined;
        });
      }
    }

    // Apply filters
    for (const filter of filters.filters) {
      items = items.filter((item) => {
        const value = (item as Record<string, unknown>)[filter.field];

        switch (filter.operator) {
          case 'eq':
            return String(value) === String(filter.value);
          case 'ne':
            return String(value) !== String(filter.value);
          case 'gt':
            return Number(value) > Number(filter.value);
          case 'gte':
            return Number(value) >= Number(filter.value);
          case 'lt':
            return Number(value) < Number(filter.value);
          case 'lte':
            return Number(value) <= Number(filter.value);
          case 'in':
            return (filter.value as unknown[]).map(String).includes(String(value));
          case 'nin':
            return !(filter.value as unknown[]).map(String).includes(String(value));
          case 'like':
            return String(value).includes(String(filter.value).replace(/%/g, ''));
          case 'ilike':
            return String(value)
              .toLowerCase()
              .includes(String(filter.value).replace(/%/g, '').toLowerCase());
          case 'null':
            return filter.value ? value === null : value !== null;
          case 'between': {
            const [min, max] = filter.value as [unknown, unknown];
            return Number(value) >= Number(min) && Number(value) <= Number(max);
          }
          default:
            return true;
        }
      });
    }

    // Apply search
    if (filters.options.search && this.searchFields.length > 0) {
      const searchTerm = filters.options.search.toLowerCase();
      items = items.filter((item) =>
        this.searchFields.some((field) => {
          const value = (item as Record<string, unknown>)[field];
          return String(value).toLowerCase().includes(searchTerm);
        })
      );
    }

    const totalCount = items.length;

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

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const start = (page - 1) * perPage;
    const paginatedItems = items.slice(start, start + perPage);

    // Load relations if requested
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const itemsWithRelations = paginatedItems.map((item) =>
      loadRelations(item as Record<string, unknown>, this._meta, includeOptions) as ModelObject<M['model']>
    );

    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: itemsWithRelations,
      result_info: {
        page,
        per_page: perPage,
        total_count: totalCount,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_prev_page: page > 1,
      },
    };
  }
}

/**
 * Memory-based Import endpoint for testing.
 * Imports data from CSV or JSON with support for create and upsert modes.
 */
export abstract class MemoryImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ImportEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Finds an existing record by upsert keys.
   */
  async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const upsertKeys = this.getUpsertKeys();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Search for matching record
    for (const existing of store.values()) {
      // Check soft delete
      if (softDeleteConfig.enabled) {
        const deletedValue = (existing as Record<string, unknown>)[softDeleteConfig.field];
        if (deletedValue !== null && deletedValue !== undefined) {
          continue; // Skip soft-deleted records
        }
      }

      // Check if all upsert keys match
      let allMatch = true;
      for (const key of upsertKeys) {
        const dataValue = (data as Record<string, unknown>)[key];
        const existingValue = (existing as Record<string, unknown>)[key];
        if (dataValue !== existingValue) {
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

  /**
   * Creates a new record.
   */
  async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate ID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || this.generateId(),
    } as ModelObject<M['model']>;

    store.set(String((record as Record<string, unknown>)[primaryKey]), record);
    return record;
  }

  /**
   * Updates an existing record.
   */
  async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const id = String((existing as Record<string, unknown>)[primaryKey]);

    // Merge existing with new data
    const updated = {
      ...existing,
      ...data,
    } as ModelObject<M['model']>;

    store.set(id, updated);
    return updated;
  }
}

// ============================================================================
// Memory-based Bulk Patch endpoint
// ============================================================================

export abstract class MemoryBulkPatchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BulkPatchEndpoint<E, M> {
  async countMatching(filters: ListFilters): Promise<number> {
    const items = this.getFilteredItems(filters);
    return items.length;
  }

  async applyPatch(
    data: Partial<ModelObject<M['model']>>,
    filters: ListFilters
  ): Promise<{ updated: number; records?: ModelObject<M['model']>[] }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const items = this.getFilteredItems(filters);
    const updated: ModelObject<M['model']>[] = [];

    for (const item of items) {
      const id = String((item as Record<string, unknown>)[primaryKey]);
      const patched = { ...item, ...data } as ModelObject<M['model']>;
      store.set(id, patched);
      updated.push(patched);
    }

    return { updated: updated.length, records: updated };
  }

  private getFilteredItems(filters: ListFilters): ModelObject<M['model']>[] {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let items = Array.from(store.values());

    for (const filter of filters.filters) {
      items = items.filter((item) => {
        const value = (item as Record<string, unknown>)[filter.field];
        switch (filter.operator) {
          case 'eq':
            return String(value) === String(filter.value);
          case 'ne':
            return String(value) !== String(filter.value);
          case 'gt':
            return Number(value) > Number(filter.value);
          case 'gte':
            return Number(value) >= Number(filter.value);
          case 'lt':
            return Number(value) < Number(filter.value);
          case 'lte':
            return Number(value) <= Number(filter.value);
          case 'in':
            return (filter.value as unknown[]).map(String).includes(String(value));
          case 'nin':
            return !(filter.value as unknown[]).map(String).includes(String(value));
          case 'like':
            return String(value).includes(String(filter.value).replace(/%/g, ''));
          case 'ilike':
            return String(value)
              .toLowerCase()
              .includes(String(filter.value).replace(/%/g, '').toLowerCase());
          case 'null':
            return filter.value ? value === null : value !== null;
          default:
            return true;
        }
      });
    }

    return items;
  }
}
