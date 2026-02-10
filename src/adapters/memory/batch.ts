import type { Env } from 'hono';
import { BatchCreateEndpoint } from '../../endpoints/batch-create';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore';
import { BatchUpsertEndpoint } from '../../endpoints/batch-upsert';
import type {
  MetaInput,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { getStore } from './helpers';

/**
 * Memory-based Batch Create endpoint for testing.
 */
export abstract class MemoryBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchCreateEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const created: ModelObject<M['model']>[] = [];

    for (const item of items) {
      const record = {
        ...item,
        [primaryKey]: (item as Record<string, unknown>)[primaryKey] || this.generateId(),
      } as ModelObject<M['model']>;

      const id = String((record as Record<string, unknown>)[primaryKey]);
      store.set(id, record);
      created.push(record);
    }

    return created;
  }
}

/**
 * Memory-based Batch Update endpoint for testing.
 * Supports soft delete filtering (cannot update deleted records).
 */
export abstract class MemoryBatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpdateEndpoint<E, M> {
  async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    for (const item of items) {
      const existing = store.get(item.id);

      if (!existing) {
        notFound.push(item.id);
        continue;
      }

      // Check if soft-deleted
      if (softDeleteConfig.enabled) {
        const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
        if (deletedAt !== null && deletedAt !== undefined) {
          notFound.push(item.id); // Treat soft-deleted as not found
          continue;
        }
      }

      const updatedRecord = { ...existing, ...item.data } as ModelObject<M['model']>;
      store.set(item.id, updatedRecord);
      updated.push(updatedRecord);
    }

    return { updated, notFound };
  }
}

/**
 * Memory-based Batch Delete endpoint for testing.
 * Supports soft delete (sets deletedAt instead of removing).
 */
export abstract class MemoryBatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchDeleteEndpoint<E, M> {
  async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const deleted: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    for (const id of ids) {
      const existing = store.get(id);

      if (!existing) {
        notFound.push(id);
        continue;
      }

      // Check if already soft-deleted
      if (softDeleteConfig.enabled) {
        const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
        if (deletedAt !== null && deletedAt !== undefined) {
          notFound.push(id); // Already deleted
          continue;
        }
      }

      if (softDeleteConfig.enabled) {
        // Soft delete: set the deletion timestamp
        const softDeleted = {
          ...existing,
          [softDeleteConfig.field]: new Date(),
        } as ModelObject<M['model']>;
        store.set(id, softDeleted);
        deleted.push(softDeleted);
      } else {
        // Hard delete: actually remove the record
        store.delete(id);
        deleted.push(existing);
      }
    }

    return { deleted, notFound };
  }
}

/**
 * Memory-based Batch Restore endpoint for testing.
 * Un-deletes multiple soft-deleted records.
 */
export abstract class MemoryBatchRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchRestoreEndpoint<E, M> {
  async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const restored: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    for (const id of ids) {
      const existing = store.get(id);

      if (!existing) {
        notFound.push(id);
        continue;
      }

      // Check if actually deleted
      const deletedAt = (existing as Record<string, unknown>)[softDeleteConfig.field];
      if (deletedAt === null || deletedAt === undefined) {
        notFound.push(id); // Not deleted, nothing to restore
        continue;
      }

      // Restore: set deletedAt to null
      const restoredRecord = {
        ...existing,
        [softDeleteConfig.field]: null,
      } as ModelObject<M['model']>;
      store.set(id, restoredRecord);
      restored.push(restoredRecord);
    }

    return { restored, notFound };
  }
}

/**
 * Memory-based Batch Upsert endpoint for testing.
 * Creates or updates multiple records based on upsert keys.
 */
export abstract class MemoryBatchUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpsertEndpoint<E, M> {
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

    // Search for matching record
    for (const existing of store.values()) {
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
   * Performs a native batch upsert operation.
   * For in-memory storage, this processes all items atomically.
   */
  protected async nativeBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    _tx?: unknown
  ): Promise<{
    items: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }>;
    createdCount: number;
    updatedCount: number;
    totalCount: number;
    errors?: Array<{ index: number; error: string }>;
  }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    const results: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }> = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const data = items[i];

      // Search for matching record
      let existingRecord: ModelObject<M['model']> | null = null;
      for (const existing of store.values()) {
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
        results.push({ data: updated, created: false, index: i });
        updatedCount++;
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
        results.push({ data: record, created: true, index: i });
        createdCount++;
      }
    }

    return {
      items: results,
      createdCount,
      updatedCount,
      totalCount: results.length,
    };
  }
}
