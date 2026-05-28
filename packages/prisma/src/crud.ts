import type { Env } from 'hono';
import { CreateEndpoint } from 'hono-crud/internal';
import { ReadEndpoint } from 'hono-crud/internal';
import { UpdateEndpoint } from 'hono-crud/internal';
import { DeleteEndpoint } from 'hono-crud/internal';
import { ListEndpoint } from 'hono-crud/internal';
import type { IncludeOptions, ListFilters, MetaInput, PaginatedResult } from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import {
  type PrismaClient,
  type PrismaModelOperations,
  batchLoadPrismaRelations,
  buildPaginatedResult,
  executePrismaQuery,
  getPrismaModel,
  loadPrismaRelations,
} from './helpers';

/**
 * Prisma Create endpoint.
 */
export abstract class PrismaCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations> {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async create(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const model = await this.getModel();

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'prisma');

    const result = await model.create({ data: record });
    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Read endpoint.
 */
export abstract class PrismaReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations> {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    const result = await model.findFirst({ where });

    if (!result) {
      return null;
    }

    // Load relations if requested
    const itemWithRelations = await loadPrismaRelations(
      this.prisma,
      result as Record<string, unknown>,
      this._meta,
      includeOptions,
    );

    return itemWithRelations as ModelObject<M['model']>;
  }
}

/**
 * Prisma Update endpoint.
 */
export abstract class PrismaUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpdateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations> {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const model = await this.getModel();

    // First find the record
    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    const existing = await model.findFirst({ where });
    if (!existing) {
      return null;
    }

    // Then update it using the primary key
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: this.applyManagedUpdateFields(data as Record<string, unknown>),
    });

    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Delete endpoint.
 */
export abstract class PrismaDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends DeleteEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction = false;

  protected async getModel(): Promise<PrismaModelOperations> {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
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
    return result as ModelObject<M['model']> | null;
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
      return result as ModelObject<M['model']>;
    } else {
      // Hard delete: actually remove the record
      const result = await model.delete({
        where: { [primaryKey]: primaryKeyValue },
      });
      return result as ModelObject<M['model']>;
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
  abstract prisma: PrismaClient;

  protected async getModel(): Promise<PrismaModelOperations> {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic
    const queryResult = await executePrismaQuery({
      model: await this.getModel(),
      filters,
      searchFields: this.searchFields,
      softDeleteConfig: this.getSoftDeleteConfig(),
      defaultPerPage: this.defaultPerPage,
    });

    // Load relations if requested using batch loading to avoid N+1 queries
    const includeOptions: IncludeOptions = { relations: filters.options.include || [] };
    const itemsWithRelations = await batchLoadPrismaRelations(
      this.prisma,
      queryResult.records as Record<string, unknown>[],
      this._meta,
      includeOptions,
    );

    return buildPaginatedResult(itemsWithRelations as ModelObject<M['model']>[], queryResult);
  }
}
