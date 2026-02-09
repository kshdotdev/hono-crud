import type { Env } from 'hono';
import { CreateEndpoint } from '../../endpoints/create';
import { ReadEndpoint } from '../../endpoints/read';
import { UpdateEndpoint } from '../../endpoints/update';
import { DeleteEndpoint } from '../../endpoints/delete';
import { ListEndpoint } from '../../endpoints/list';
import { RestoreEndpoint } from '../../endpoints/restore';
import { encodeCursor, decodeCursor } from '../../core/types';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  IncludeOptions,
  RelationConfig,
  NestedUpdateInput,
  NestedWriteResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { getStore, loadRelations } from './helpers';

/**
 * Memory-based Create endpoint for testing.
 * Supports nested writes for creating related records.
 */
export abstract class MemoryCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   * Override to customize ID generation.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  async create(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate ID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || this.generateId(),
    } as ModelObject<M['model']>;

    const id = String((record as Record<string, unknown>)[primaryKey]);
    store.set(id, record);

    return record;
  }

  /**
   * Creates nested related records for the parent.
   */
  protected async createNested(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    data: unknown
  ): Promise<unknown[]> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    const created: Record<string, unknown>[] = [];

    // Normalize data to array
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;

      const record = {
        ...item,
        id: crypto.randomUUID(),
        [relationConfig.foreignKey]: parentId,
      };

      relatedStore.set(record.id, record);
      created.push(record);
    }

    return created;
  }
}

/**
 * Memory-based Read endpoint for testing.
 * Supports soft delete filtering and relation includes.
 */
export abstract class MemoryReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const record = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!record) {
      return null;
    }

    // Check if soft-deleted
    if (softDeleteConfig.enabled) {
      const deletedAt = (record as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt !== null && deletedAt !== undefined) {
        return null; // Record is soft-deleted
      }
    }

    // Check additional filters
    if (additionalFilters) {
      for (const [key, value] of Object.entries(additionalFilters)) {
        if (String((record as Record<string, unknown>)[key]) !== value) {
          return null;
        }
      }
    }

    // Load relations if requested
    return loadRelations(record as Record<string, unknown>, this._meta, includeOptions) as ModelObject<M['model']>;
  }
}

/**
 * Memory-based Update endpoint for testing.
 * Supports soft delete filtering (cannot update deleted records).
 * Supports nested writes for creating/updating/deleting related records.
 */
export abstract class MemoryUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpdateEndpoint<E, M> {
  /**
   * Finds an existing record for audit logging (before update).
   */
  protected async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    // Check if soft-deleted
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

    // Return a copy to preserve the state before update
    return { ...existing } as ModelObject<M['model']>;
  }

  async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    // Check if soft-deleted
    if (softDeleteConfig.enabled) {
      const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt !== null && deletedAt !== undefined) {
        return null; // Cannot update soft-deleted record
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

    const updated = { ...existing, ...data } as ModelObject<M['model']>;
    store.set(lookupValue, updated);

    return updated;
  }

  /**
   * Processes nested write operations for related records.
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

    // Handle create operations
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

    // Handle update operations
    if (operations.update) {
      for (const item of operations.update) {
        if (!item.id) continue;

        const existing = relatedStore.get(String(item.id));
        if (!existing) continue;

        // Verify the record belongs to this parent
        if (existing[relationConfig.foreignKey] !== parentId) continue;

        const updated = { ...existing, ...item };
        relatedStore.set(String(item.id), updated);
        result.updated.push(updated);
      }
    }

    // Handle delete operations
    if (operations.delete) {
      for (const id of operations.delete) {
        const existing = relatedStore.get(String(id));
        if (!existing) continue;

        // Verify the record belongs to this parent
        if (existing[relationConfig.foreignKey] !== parentId) continue;

        relatedStore.delete(String(id));
        result.deleted.push(id);
      }
    }

    // Handle connect operations
    if (operations.connect) {
      for (const id of operations.connect) {
        const existing = relatedStore.get(String(id));
        if (!existing) continue;

        // Update the foreign key to connect to this parent
        const updated = { ...existing, [relationConfig.foreignKey]: parentId };
        relatedStore.set(String(id), updated);
        result.connected.push(id);
      }
    }

    // Handle disconnect operations
    if (operations.disconnect) {
      for (const id of operations.disconnect) {
        const existing = relatedStore.get(String(id));
        if (!existing) continue;

        // Verify the record belongs to this parent
        if (existing[relationConfig.foreignKey] !== parentId) continue;

        // Set foreign key to null to disconnect
        const updated = { ...existing, [relationConfig.foreignKey]: null };
        relatedStore.set(String(id), updated);
        result.disconnected.push(id);
      }
    }

    // Handle set operation (for hasOne - replace the relation)
    if (operations.set !== undefined) {
      // First, disconnect any existing related record
      const existingRelated = Array.from(relatedStore.values()).filter(
        (r) => r[relationConfig.foreignKey] === parentId
      );
      for (const existing of existingRelated) {
        if (existing.id) {
          const updated = { ...existing, [relationConfig.foreignKey]: null };
          relatedStore.set(String(existing.id), updated);
          result.disconnected.push(existing.id as string | number);
        }
      }

      // Then set the new relation
      if (operations.set !== null) {
        const record = {
          ...operations.set,
          id: crypto.randomUUID(),
          [relationConfig.foreignKey]: parentId,
        };
        relatedStore.set(record.id, record);
        result.created.push(record);
      }
    }

    return result;
  }
}

/**
 * Memory-based Delete endpoint for testing.
 * Supports soft delete (sets deletedAt instead of removing).
 * Supports cascade operations (cascade, setNull, restrict).
 */
export abstract class MemoryDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends DeleteEndpoint<E, M> {
  /**
   * Finds a record without deleting it.
   */
  async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    // Check if already soft-deleted
    if (softDeleteConfig.enabled) {
      const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt !== null && deletedAt !== undefined) {
        return null; // Already deleted
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

  /**
   * Counts related records for restrict check.
   */
  protected async countRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig
  ): Promise<number> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    let count = 0;

    for (const item of relatedStore.values()) {
      if (item[relationConfig.foreignKey] === parentId) {
        count++;
      }
    }

    return count;
  }

  /**
   * Deletes related records for cascade delete.
   */
  protected async deleteRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig
  ): Promise<number> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    let deletedCount = 0;

    // Find and delete related records
    for (const [id, item] of relatedStore.entries()) {
      if (item[relationConfig.foreignKey] === parentId) {
        relatedStore.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Sets foreign key to null for related records.
   */
  protected async nullifyRelated(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig
  ): Promise<number> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    let nullifiedCount = 0;

    // Find and nullify related records
    for (const [id, item] of relatedStore.entries()) {
      if (item[relationConfig.foreignKey] === parentId) {
        const updated = { ...item, [relationConfig.foreignKey]: null };
        relatedStore.set(id, updated);
        nullifiedCount++;
      }
    }

    return nullifiedCount;
  }

  async delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    // Check if already soft-deleted
    if (softDeleteConfig.enabled) {
      const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt !== null && deletedAt !== undefined) {
        return null; // Already deleted
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

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      const updated = {
        ...existing,
        [softDeleteConfig.field]: new Date(),
      } as ModelObject<M['model']>;
      store.set(lookupValue, updated);
      return updated;
    } else {
      // Hard delete: actually remove the record
      store.delete(lookupValue);
      return existing;
    }
  }
}

/**
 * Memory-based List endpoint for testing.
 * Supports soft delete filtering with withDeleted and onlyDeleted options.
 */
export abstract class MemoryListEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
  async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let items = Array.from(store.values());
    const softDeleteConfig = this.getSoftDeleteConfig();

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

    // Cursor-based pagination
    if (this.cursorPaginationEnabled && (filters.options.cursor || filters.options.limit)) {
      const cursorField = this.cursorField || 'id';
      const limit = filters.options.limit || filters.options.per_page || this.defaultPerPage;

      // If cursor is provided, find the starting position
      let startIndex = 0;
      if (filters.options.cursor) {
        const cursorValue = decodeCursor(filters.options.cursor);
        if (cursorValue !== null) {
          const cursorIdx = items.findIndex((item) =>
            String((item as Record<string, unknown>)[cursorField]) === cursorValue
          );
          if (cursorIdx !== -1) {
            startIndex = cursorIdx + 1; // Start after the cursor item
          }
        }
      }

      const paginatedItems = items.slice(startIndex, startIndex + limit);

      // Load relations if requested
      const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
      const itemsWithRelations = paginatedItems.map((item) =>
        loadRelations(item as Record<string, unknown>, this._meta, includeOptions) as ModelObject<M['model']>
      );

      const hasNextPage = startIndex + limit < items.length;
      const hasPrevPage = startIndex > 0;

      // Build cursors from last/first items
      let nextCursor: string | undefined;
      let prevCursor: string | undefined;

      if (hasNextPage && paginatedItems.length > 0) {
        const lastItem = paginatedItems[paginatedItems.length - 1] as Record<string, unknown>;
        nextCursor = encodeCursor(lastItem[cursorField] as string | number);
      }

      if (hasPrevPage && startIndex > 0) {
        const prevItem = items[startIndex - 1] as Record<string, unknown>;
        prevCursor = encodeCursor(prevItem[cursorField] as string | number);
      }

      return {
        result: itemsWithRelations,
        result_info: {
          page: 0,
          per_page: limit,
          total_count: totalCount,
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage,
          next_cursor: nextCursor,
          prev_cursor: prevCursor,
        },
      };
    }

    // Offset-based pagination (default)
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
 * Memory-based Restore endpoint for testing.
 * Un-deletes soft-deleted records by setting deletedAt back to null.
 */
export abstract class MemoryRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RestoreEndpoint<E, M> {
  async restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    // Check if actually deleted
    const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
    if (deletedAt === null || deletedAt === undefined) {
      return null; // Not deleted, nothing to restore
    }

    // Check additional filters
    if (additionalFilters) {
      for (const [key, value] of Object.entries(additionalFilters)) {
        if (String((existing as Record<string, unknown>)[key]) !== value) {
          return null;
        }
      }
    }

    // Restore: set deletedAt to null
    const restored = {
      ...existing,
      [softDeleteConfig.field]: null,
    } as ModelObject<M['model']>;
    store.set(lookupValue, restored);

    return restored;
  }
}
