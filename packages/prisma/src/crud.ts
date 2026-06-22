import type { Env } from 'hono';
import { CreateEndpoint } from 'hono-crud/internal';
import { ReadEndpoint } from 'hono-crud/internal';
import { UpdateEndpoint } from 'hono-crud/internal';
import { DeleteEndpoint } from 'hono-crud/internal';
import { ListEndpoint } from 'hono-crud/internal';
import { buildCursorPage } from 'hono-crud/internal';
import type { IncludeOptions, ListFilters, MetaInput, PaginatedResult } from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { getPrismaClient } from './connection';
import {
  type PrismaClient,
  type PrismaModelOperations,
  batchLoadPrismaRelations,
  buildPaginatedResult,
  executePrismaQuery,
  getPrismaModel,
  getPrismaTransaction,
  loadPrismaRelations,
} from './helpers';

/**
 * Prisma Create endpoint.
 */
export abstract class PrismaCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  declare prisma?: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model);
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   * `this._tx` is resolved first by getPrismaClient, so every model access
   * inside the verb runs on the transaction client.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return getPrismaTransaction(getPrismaClient(this))(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }

  override async create(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma');

    const result = await model.create({ data: record });
    return result;
  }
}

/**
 * Prisma Read endpoint.
 */
export abstract class PrismaReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  declare prisma?: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Exclude soft-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const result = await model.findFirst({ where });

    if (!result) {
      return null;
    }

    // Load relations if requested
    const itemWithRelations = await loadPrismaRelations(
      getPrismaClient(this),
      result,
      this._meta,
      includeOptions,
    );

    return itemWithRelations;
  }
}

/**
 * Prisma Update endpoint.
 */
export abstract class PrismaUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpdateEndpoint<E, M> {
  declare prisma?: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model);
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   * `this._tx` is resolved first by getPrismaClient, so every model access
   * inside the verb runs on the transaction client.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return getPrismaTransaction(getPrismaClient(this))(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }

  /**
   * Finds an existing record for audit logging (before update).
   */
  protected override async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Cannot update soft-deleted records
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const result = await model.findFirst({ where });
    return result ?? null;
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();

    // First find the record (excluding soft-deleted)
    const existing = await this.findExisting(lookupValue, additionalFilters);
    if (!existing) {
      return null;
    }

    // Then update it using the primary key
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: this.applyManagedUpdateFields(data as Record<string, unknown>),
    });

    return result;
  }
}

/**
 * Prisma Delete endpoint.
 */
export abstract class PrismaDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends DeleteEndpoint<E, M> {
  declare prisma?: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model);
  }

  /**
   * Override handle to wrap in transaction when useTransaction is true.
   * `this._tx` is resolved first by getPrismaClient, so every model access
   * inside the verb runs on the transaction client.
   */
  override async handle(): Promise<Response> {
    if (!this.useTransaction) {
      return super.handle();
    }

    // Execute the entire operation within a transaction
    return getPrismaTransaction(getPrismaClient(this))(async (tx) => {
      this._tx = tx;
      try {
        return await super.handle();
      } finally {
        this._tx = undefined;
      }
    });
  }

  /**
   * Finds a record without deleting it (for constraint checks).
   */
  override async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Exclude already-deleted records for soft delete
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const result = await model.findFirst({ where });
    return result;
  }

  override async delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Build where clause
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    // Exclude already-deleted records for soft delete
    if (softDeleteConfig.enabled) {
      where[softDeleteConfig.field] = null;
    }

    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    const primaryKey = this._meta.model.primaryKeys[0];
    const primaryKeyValue = (existing as Record<string, unknown>)[primaryKey];

    if (softDeleteConfig.enabled) {
      // Soft delete: set the deletion timestamp
      const result = await model.update({
        where: { [primaryKey]: primaryKeyValue },
        data: { [softDeleteConfig.field]: new Date() },
      });
      return result;
    } else {
      // Hard delete: actually remove the record
      const result = await model.delete({
        where: { [primaryKey]: primaryKeyValue },
      });
      return result;
    }
  }
}

/**
 * Prisma List endpoint with filtering, sorting, and pagination.
 */
export abstract class PrismaListEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
  declare prisma?: PrismaClient;

  /** Cursor pagination is implemented via Prisma's native `cursor` window. */
  protected override supportsCursorPagination = true;

  protected async getModel(): Promise<PrismaModelOperations<ModelObject<M['model']>>> {
    return getPrismaModel<ModelObject<M['model']>>(getPrismaClient(this), this._meta.model);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic
    const queryResult = await executePrismaQuery({
      model: await this.getModel(),
      filters,
      searchFields: this.searchFields,
      softDeleteConfig: this.getSoftDeleteConfig(),
      defaultPerPage: this.defaultPerPage,
      cursorField: this.isCursorPaginationActive() ? this.cursorField || 'id' : undefined,
    });

    const includeOptions: IncludeOptions = {
      relations: filters.options.include || [],
      // Scope included related rows to the caller (owner-scope + soft-delete),
      // honoring `?withDeleted` for the related soft-delete filter.
      scope: this.getRelationScope(filters.options.withDeleted),
    };

    // Keyset cursor page: trim the has-more sentinel row before loading
    // relations, then return the canonical cursor-mode envelope.
    if (queryResult.cursor) {
      const { items, result_info } = buildCursorPage({
        rows: queryResult.records,
        limit: queryResult.cursor.limit,
        totalCount: queryResult.totalCount,
        cursorField: this.cursorField || 'id',
        cursorApplied: queryResult.cursor.applied,
      });
      const itemsWithRelations = await batchLoadPrismaRelations(
        getPrismaClient(this),
        items,
        this._meta,
        includeOptions,
      );
      return { result: itemsWithRelations, result_info };
    }

    // Load relations if requested using batch loading to avoid N+1 queries
    const itemsWithRelations = await batchLoadPrismaRelations(
      getPrismaClient(this),
      queryResult.records,
      this._meta,
      includeOptions,
    );

    return buildPaginatedResult(itemsWithRelations, queryResult);
  }
}
