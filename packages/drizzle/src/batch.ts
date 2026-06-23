import { eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Env } from 'hono';
import { BatchCreateEndpoint } from 'hono-crud/internal';
import { BatchUpdateEndpoint, type BatchUpdateItem } from 'hono-crud/internal';
import { BatchDeleteEndpoint } from 'hono-crud/internal';
import { BatchRestoreEndpoint } from 'hono-crud/internal';
import type { MetaInput } from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { getDrizzleDb } from './connection';
import {
  type DrizzleColumn,
  type DrizzleDatabaseConstraint,
  type DrizzleSql,
  type DrizzleTable,
  and,
  cast,
  getColumn,
  getTable,
} from './helpers';

/**
 * Drizzle Batch Create endpoint.
 * Works with any Drizzle dialect (PostgreSQL, MySQL, SQLite).
 */
export abstract class DrizzleBatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends BatchCreateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /** Gets the database instance from property or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[],
  ): Promise<ModelObject<M['model']>[]> {
    const table = this.getTable();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const records = items.map((item) =>
      this.applyManagedInsertFields(item as Record<string, unknown>, 'drizzle'),
    );

    const result = await cast<ModelObject<M['model']>>(this.getDb())
      .insert(table)
      .values(records)
      .returning();

    return result;
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends BatchUpdateEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DB;

  /** Gets the database instance from property or context */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[],
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];
    // Owner-scope: only the caller's own rows are updatable (cross-tenant ids fall
    // through to `notFound`).
    const tenant = this.getTenantScopeFilter();

    // Process each update individually (Drizzle doesn't have bulk update with different values)
    for (const item of items) {
      const conditions: DrizzleSql[] = [eq(lookupColumn, item.id)];

      // Filter out soft-deleted records
      if (softDeleteConfig.enabled) {
        conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
      }

      if (tenant) {
        conditions.push(eq(this.getColumn(tenant.field), tenant.value));
      }

      const result = await cast<ModelObject<M['model']>>(this.getDb())
        .update(table)
        .set(this.applyManagedUpdateFields(item.data as Record<string, unknown>))
        .where(and(...conditions))
        .returning();

      if (result[0]) {
        updated.push(result[0]);
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends BatchDeleteEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DB;

  /** Gets the database instance from property or context. */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async batchDelete(
    ids: string[],
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition for all IDs
    const conditions: DrizzleSql[] = [inArray(lookupColumn, ids)];

    // For soft delete, exclude already-deleted records
    if (softDeleteConfig.enabled) {
      conditions.push(isNull(this.getColumn(softDeleteConfig.field)));
    }

    // Owner-scope: only the caller's own rows are deletable.
    const tenant = this.getTenantScopeFilter();
    if (tenant) {
      conditions.push(eq(this.getColumn(tenant.field), tenant.value));
    }

    let result: ModelObject<M['model']>[];

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      result = await cast<ModelObject<M['model']>>(this.getDb())
        .update(table)
        .set({ [softDeleteConfig.field]: new Date() } as Record<string, unknown>)
        .where(and(...conditions))
        .returning();
    } else {
      // Hard delete: actually remove the records
      result = await cast<ModelObject<M['model']>>(this.getDb())
        .delete(table)
        .where(and(...conditions))
        .returning();
    }

    const deleted = result;
    const deletedIds = new Set(
      deleted.map((item) => String((item as Record<string, unknown>)[this.lookupField])),
    );
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
  DB extends DrizzleDatabaseConstraint = DrizzleDatabaseConstraint,
> extends BatchRestoreEndpoint<E, M> {
  /** Drizzle database instance. Can be undefined if using context injection. */
  db?: DB;

  /** Gets the database instance from property or context. */
  protected getDb(): DB {
    return getDrizzleDb(this) as DB;
  }

  protected getTable(): DrizzleTable {
    return getTable(this._meta);
  }

  protected getColumn(field: string): DrizzleColumn {
    return getColumn(this.getTable(), field);
  }

  override async batchRestore(
    ids: string[],
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const table = this.getTable();
    const lookupColumn = this.getColumn(this.lookupField);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build condition: IDs that are actually deleted
    const conditions: DrizzleSql[] = [
      inArray(lookupColumn, ids),
      isNotNull(this.getColumn(softDeleteConfig.field)),
    ];

    // Owner-scope: only the caller's own rows are restorable.
    const tenant = this.getTenantScopeFilter();
    if (tenant) {
      conditions.push(eq(this.getColumn(tenant.field), tenant.value));
    }

    // Set deletedAt to null to restore the records
    const result = await cast<ModelObject<M['model']>>(this.getDb())
      .update(table)
      .set({ [softDeleteConfig.field]: null } as Record<string, unknown>)
      .where(and(...conditions))
      .returning();

    const restored = result;
    const restoredIds = new Set(
      restored.map((item) => String((item as Record<string, unknown>)[this.lookupField])),
    );
    const notFound = ids.filter((id) => !restoredIds.has(id));

    return { restored, notFound };
  }
}
