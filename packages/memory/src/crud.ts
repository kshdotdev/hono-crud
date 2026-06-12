import type { Env } from 'hono';
import { CreateEndpoint } from 'hono-crud/internal';
import { ReadEndpoint } from 'hono-crud/internal';
import { UpdateEndpoint } from 'hono-crud/internal';
import { DeleteEndpoint } from 'hono-crud/internal';
import { ListEndpoint } from 'hono-crud/internal';
import { RestoreEndpoint } from 'hono-crud/internal';
import { buildCursorPage, decodeCursor } from 'hono-crud/internal';
import type {
  IncludeOptions,
  ListFilters,
  MetaInput,
  NestedUpdateInput,
  NestedWriteResult,
  PaginatedResult,
  RelationConfig,
} from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { getStore, loadRelations, queryMemoryStore } from './helpers';
import { isVisible } from './visibility';

/**
 * Sentinel placed on `HookContext.db.tx` for memory-adapter writes. The
 * memory adapter has no real transaction machinery, so throwing inside an
 * `after*` hook does NOT roll back the parent write — the sentinel makes
 * that explicit so downstream code can feature-detect.
 */
export const MEMORY_NOOP_TX = Object.freeze({
  __memoryNoopTx: true as const,
  rolledBack: false as const,
});

/**
 * Memory-based Create endpoint for testing.
 * Supports nested writes for creating related records.
 */
export abstract class MemoryCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  protected override _tx: unknown = MEMORY_NOOP_TX;

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

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    // `generateId()` stays the overridable default-branch generator;
    // `id:'database'` throws here (memory has no database).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory', () =>
      this.generateId(),
    ) as ModelObject<M['model']>;

    const id = String((record as Record<string, unknown>)[primaryKey]);
    store.set(id, record);

    return record;
  }

  /**
   * Creates nested related records for the parent.
   */
  protected async createNested(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    data: unknown,
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
    includeOptions?: IncludeOptions,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const record = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!record) {
      return null;
    }

    if (!isVisible(record, softDeleteConfig, additionalFilters)) {
      return null;
    }

    // Load relations if requested
    return loadRelations(
      record as Record<string, unknown>,
      this._meta,
      includeOptions,
    ) as ModelObject<M['model']>;
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
  protected override _tx: unknown = MEMORY_NOOP_TX;

  /**
   * Finds an existing record for audit logging (before update).
   */
  protected async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    if (!isVisible(existing, softDeleteConfig, additionalFilters)) {
      return null;
    }

    // Return a copy to preserve the state before update
    return { ...existing } as ModelObject<M['model']>;
  }

  async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    if (!isVisible(existing, softDeleteConfig, additionalFilters)) {
      return null;
    }

    const updated = {
      ...existing,
      ...this.applyManagedUpdateFields(data as Record<string, unknown>),
    } as ModelObject<M['model']>;
    store.set(lookupValue, updated);

    return updated;
  }

  /**
   * Processes nested write operations for related records.
   */
  protected async processNestedWrites(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
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
        (r) => r[relationConfig.foreignKey] === parentId,
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
  protected override _tx: unknown = MEMORY_NOOP_TX;

  /**
   * Finds a record without deleting it.
   */
  async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    if (!isVisible(existing, softDeleteConfig, additionalFilters)) {
      return null;
    }

    return existing;
  }

  /**
   * Counts related records for restrict check.
   */
  protected async countRelated(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
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
    _relationName: string,
    relationConfig: RelationConfig,
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
    _relationName: string,
    relationConfig: RelationConfig,
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
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) {
      return null;
    }

    if (!isVisible(existing, softDeleteConfig, additionalFilters)) {
      return null;
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
  protected override supportsCursorPagination = true;

  async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const items = queryMemoryStore(store, filters, this.searchFields, this.getSoftDeleteConfig());
    const totalCount = items.length;
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };

    const loadItemRelations = (item: ModelObject<M['model']>) =>
      loadRelations(item as Record<string, unknown>, this._meta, includeOptions) as ModelObject<
        M['model']
      >;

    // Keyset cursor pagination (next-only). `cursor`/`limit` options only
    // exist when cursor pagination is enabled AND supported; rows are already
    // ordered by the cursor field ascending — core forces `order_by` during a
    // cursor walk.
    if (filters.options.cursor !== undefined || filters.options.limit !== undefined) {
      const cursorField = this.cursorField || 'id';
      const limit = filters.options.limit || filters.options.per_page || this.defaultPerPage;
      const decoded = filters.options.cursor ? decodeCursor(filters.options.cursor) : null;

      // Strictly-after-the-boundary keyset window (the memory equivalent of
      // `WHERE cursorField > decoded`, tolerant of a deleted boundary row).
      // An invalid cursor starts from the beginning, matching the SQL
      // adapters. Numeric cursor fields compare numerically; everything else
      // compares as strings.
      const windowItems =
        decoded === null
          ? items
          : items.filter((item) => {
              const value = (item as Record<string, unknown>)[cursorField];
              return typeof value === 'number' ? value > Number(decoded) : String(value) > decoded;
            });

      const { items: pageItems, result_info } = buildCursorPage({
        rows: windowItems.slice(0, limit + 1),
        limit,
        totalCount,
        cursorField,
        cursorApplied: decoded !== null,
      });

      return { result: pageItems.map(loadItemRelations), result_info };
    }

    // Offset-based pagination (default)
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const start = (page - 1) * perPage;
    const paginatedItems = items.slice(start, start + perPage);

    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: paginatedItems.map(loadItemRelations),
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
    additionalFilters?: Record<string, string>,
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
