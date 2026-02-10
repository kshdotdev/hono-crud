import type { Env } from 'hono';
import { BatchCreateEndpoint } from '../../endpoints/batch-create';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore';
import { BatchUpsertEndpoint } from '../../endpoints/batch-upsert';
import { RestoreEndpoint } from '../../endpoints/restore';
import type {
  MetaInput,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type PrismaClient,
  type PrismaModelOperations,
  getPrismaModel,
  getModelName,
} from './helpers';

/**
 * Prisma Restore endpoint for un-deleting soft-deleted records.
 *
 * Only works with models that have `softDelete` enabled.
 * Sets the deletion timestamp back to null.
 */
export abstract class PrismaRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RestoreEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build where clause
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      // Only restore records that are actually deleted
      [softDeleteConfig.field]: { not: null },
      ...additionalFilters,
    };

    // Find the deleted record first
    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    // Then restore it by setting deletedAt to null
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: { [softDeleteConfig.field]: null },
    });

    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Batch Create endpoint.
 * Creates multiple records in a single request.
 */
export abstract class PrismaBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchCreateEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate IDs for items that don't have them
    const records = items.map((item) => ({
      ...item,
      [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    }));

    // Prisma's createMany doesn't return the created records, so we need to use
    // individual creates or a transaction with creates
    const created: ModelObject<M['model']>[] = [];

    await this.prisma.$transaction(async (tx) => {
      const txModel = tx[getModelName(this._meta.model.tableName)];
      for (const record of records) {
        const result = await txModel.create({ data: record });
        created.push(result as ModelObject<M['model']>);
      }
    });

    return created;
  }
}

/**
 * Prisma Batch Update endpoint.
 * Updates multiple records in a single request.
 *
 * Supports soft delete filtering (cannot update deleted records).
 */
export abstract class PrismaBatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpdateEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Extract all IDs for batch lookup
    const allIds = items.map(item => item.id);

    // Build where clause for batch lookup
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: allIds },
    };

    // Filter out soft-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    // Batch lookup: Find all existing records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Process each update
    for (const item of items) {
      const existing = existingMap.get(item.id);
      if (!existing) {
        notFound.push(item.id);
        continue;
      }

      // Update using primary key
      const result = await model.update({
        where: { [primaryKey]: existing[primaryKey] },
        data: item.data as Record<string, unknown>,
      });

      updated.push(result as ModelObject<M['model']>);
    }

    return { updated, notFound };
  }
}

/**
 * Prisma Batch Delete endpoint.
 * Deletes multiple records in a single request.
 *
 * Supports soft delete when the model has `softDelete` configured.
 */
export abstract class PrismaBatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchDeleteEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const deleted: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Build where clause for batch lookup
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: ids },
    };

    // For soft delete, exclude already-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    // Batch lookup: Find all existing records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Determine which IDs were not found
    for (const id of ids) {
      if (!existingMap.has(id)) {
        notFound.push(id);
      }
    }

    // Process deletions for existing records
    for (const id of ids) {
      const existing = existingMap.get(id);
      if (!existing) {
        continue; // Already added to notFound
      }

      if (softDeleteConfig.enabled) {
        // Soft delete: set the deletion timestamp
        const result = await model.update({
          where: { [primaryKey]: existing[primaryKey] },
          data: { [softDeleteConfig.field]: new Date() },
        });
        deleted.push(result as ModelObject<M['model']>);
      } else {
        // Hard delete: actually remove the record
        const result = await model.delete({
          where: { [primaryKey]: existing[primaryKey] },
        });
        deleted.push(result as ModelObject<M['model']>);
      }
    }

    return { deleted, notFound };
  }
}

/**
 * Prisma Batch Restore endpoint for un-deleting soft-deleted records.
 *
 * Only works with models that have `softDelete` enabled.
 */
export abstract class PrismaBatchRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchRestoreEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const primaryKey = this._meta.model.primaryKeys[0];
    const restored: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Build where clause - only find records that are actually deleted
    const where: Record<string, unknown> = {
      [this.lookupField]: { in: ids },
      [softDeleteConfig.field]: { not: null },
    };

    // Batch lookup: Find all deleted records in a single query (fixes N+1)
    const existingRecords = await model.findMany({ where });

    // Create a map for quick lookup by the lookup field
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const record of existingRecords) {
      const id = (record as Record<string, unknown>)[this.lookupField] as string;
      existingMap.set(id, record as Record<string, unknown>);
    }

    // Process restores
    for (const id of ids) {
      const existing = existingMap.get(id);
      if (!existing) {
        notFound.push(id);
        continue;
      }

      // Restore by setting deletedAt to null
      const result = await model.update({
        where: { [primaryKey]: existing[primaryKey] },
        data: { [softDeleteConfig.field]: null },
      });

      restored.push(result as ModelObject<M['model']>);
    }

    return { restored, notFound };
  }
}

/**
 * Prisma Batch Upsert endpoint.
 * Creates or updates multiple records in a single request.
 *
 * Supports native Prisma upsert via `useNativeUpsert = true` for atomic operations.
 * Note: Prisma doesn't have a native batch upsert, so this uses individual upsert calls
 * within a transaction for atomicity.
 */
export abstract class PrismaBatchUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpsertEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = true;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Finds an existing record by upsert keys.
   */
  override async findExisting(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
    const upsertKeys = this.getUpsertKeys();

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    if (Object.keys(where).length === 0) {
      return null;
    }

    const result = await model.findFirst({ where });
    return (result as ModelObject<M['model']>) || null;
  }

  /**
   * Creates a new record.
   */
  override async create(
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate UUID if not provided
    const record = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    const result = await model.create({ data: record });
    return result as ModelObject<M['model']>;
  }

  /**
   * Updates an existing record.
   */
  override async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const primaryKey = this._meta.model.primaryKeys[0];

    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data,
    });

    return result as ModelObject<M['model']>;
  }

  /**
   * Performs native Prisma batch upsert using individual upsert calls in a transaction.
   */
  protected override async nativeBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    _tx?: unknown
  ): Promise<{
    items: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }>;
    createdCount: number;
    updatedCount: number;
    totalCount: number;
    errors?: Array<{ index: number; error: string }>;
  }> {
    if (items.length === 0) {
      return {
        items: [],
        createdCount: 0,
        updatedCount: 0,
        totalCount: 0,
      };
    }

    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    const executeUpserts = async (prismaClient: PrismaClient) => {
      const model = prismaClient[getModelName(this._meta.model.tableName)];
      const results: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }> = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
          // Build where clause from upsert keys
          const where: Record<string, unknown> = {};
          for (const key of upsertKeys) {
            const value = (item as Record<string, unknown>)[key];
            if (value !== undefined) {
              where[key] = value;
            }
          }

          // Build create data with generated UUID
          const createData = {
            ...item,
            [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
          };

          // Build update data - exclude upsert keys and primary key, filter create-only fields
          const updateData: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(item)) {
            if (!upsertKeys.includes(key) && key !== primaryKey) {
              if (!this.createOnlyFields?.includes(key)) {
                updateData[key] = value;
              }
            }
          }

          const result = await model.upsert({
            where,
            create: createData,
            update: Object.keys(updateData).length > 0 ? updateData : {},
          });

          results.push({
            data: result as ModelObject<M['model']>,
            created: false, // Cannot determine with native upsert
            index: i,
          });
        } catch (error) {
          if (this.continueOnError) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            throw error;
          }
        }
      }

      return { results, errors };
    };

    let outcome: { results: typeof items extends unknown[] ? Array<{ data: ModelObject<M['model']>; created: boolean; index: number }> : never; errors: Array<{ index: number; error: string }> };

    if (this.useTransaction) {
      outcome = await this.prisma.$transaction(executeUpserts);
    } else {
      outcome = await executeUpserts(this.prisma);
    }

    const result: {
      items: Array<{ data: ModelObject<M['model']>; created: boolean; index: number }>;
      createdCount: number;
      updatedCount: number;
      totalCount: number;
      errors?: Array<{ index: number; error: string }>;
    } = {
      items: outcome.results,
      createdCount: 0, // Cannot determine with native upsert
      updatedCount: outcome.results.length, // Assume all were updates (conservative)
      totalCount: outcome.results.length,
    };

    if (outcome.errors.length > 0) {
      result.errors = outcome.errors;
    }

    return result;
  }
}
