import type { Env } from 'hono';
import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import type { SQL, Table, Column } from 'drizzle-orm';
import { BatchCreateEndpoint } from '../../endpoints/batch-create';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore';
import type {
  MetaInput,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type DrizzleDatabase,
  cast,
  getTable,
  getColumn,
} from './helpers';

/**
 * Drizzle Batch Create endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 */
export abstract class DrizzleBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchCreateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const table = this.getTable();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Generate IDs for items that don't have them
    const records = items.map((item) => ({
      ...item,
      [primaryKey]: (item as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    }));

    const result = await cast(this.getDb())
      .insert(table)
      .values(records)
      .returning();

    return result as ModelObject<M['model']>[];
  }
}

/**
 * Drizzle Batch Update endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete filtering (cannot update deleted records).
 */
export abstract class DrizzleBatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpdateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Process each update individually (Drizzle doesn't have bulk update with different values)
    for (const item of items) {
      const conditions: SQL[] = [eq(lookupColumn, item.id)];

      // Filter out soft-deleted records
      if (softDeleteConfig.enabled) {
        conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
      }

      const result = await cast(this.getDb())
        .update(table)
        .set(item.data as Record<string, unknown>)
        .where(and(...conditions))
        .returning();

      if (result[0]) {
        updated.push(result[0] as ModelObject<M['model']>);
      } else {
        notFound.push(item.id);
      }
    }

    return { updated, notFound };
  }
}

/**
 * Drizzle Batch Delete endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Supports soft delete when the model has `softDelete` configured.
 */
export abstract class DrizzleBatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchDeleteEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition for all IDs
    const conditions: SQL[] = [inArray(lookupColumn, ids)];

    // For soft delete, exclude already-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    let result: unknown[];

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      result = await cast(this.getDb())
        .update(table)
        .set({ [softDeleteConfig.field]: new Date() } as Record<string, unknown>)
        .where(and(...conditions))
        .returning();
    } else {
      // Hard delete: actually remove the records
      result = await cast(this.getDb())
        .delete(table)
        .where(and(...conditions))
        .returning();
    }

    const deleted = result as ModelObject<M['model']>[];
    const deletedIds = new Set(deleted.map((item) => String((item as Record<string, unknown>)[this.lookupField])));
    const notFound = ids.filter((id) => !deletedIds.has(id));

    return { deleted, notFound };
  }
}

/**
 * Drizzle Batch Restore endpoint for un-deleting soft-deleted records.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 *
 * Only works with models that have `softDelete` enabled.
 */
export abstract class DrizzleBatchRestoreEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchRestoreEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DrizzleDatabase;

  /** Gets the database instance from property or context. */
  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumn(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition: IDs that are actually deleted
    const conditions: SQL[] = [
      inArray(lookupColumn, ids),
      isNotNull(this.getColumn(softDeleteConfig.field)),
    ];

    // Set deletedAt to null to restore the records
    const result = await cast(this.getDb())
      .update(table)
      .set({ [softDeleteConfig.field]: null } as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    const restored = result as ModelObject<M['model']>[];
    const restoredIds = new Set(restored.map((item) => String((item as Record<string, unknown>)[this.lookupField])));
    const notFound = ids.filter((id) => !restoredIds.has(id));

    return { restored, notFound };
  }
}
