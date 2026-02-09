import type { Env } from 'hono';
import { CreateEndpoint } from '../../endpoints/create';
import { ReadEndpoint } from '../../endpoints/read';
import { UpdateEndpoint } from '../../endpoints/update';
import { DeleteEndpoint } from '../../endpoints/delete';
import { ListEndpoint } from '../../endpoints/list';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  IncludeOptions,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import {
  type PrismaClient,
  type PrismaModelOperations,
  getPrismaModel,
  loadPrismaRelations,
  batchLoadPrismaRelations,
  executePrismaQuery,
  buildPaginatedResult,
} from './helpers';

/**
 * Prisma Create endpoint.
 */
export abstract class PrismaCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async create(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
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
}

/**
 * Prisma Read endpoint.
 */
export abstract class PrismaReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ReadEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();

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
      includeOptions
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
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();

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
      data,
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
  protected useTransaction: boolean = false;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  /**
   * Finds a record without deleting it (for constraint checks).
   */
  override async findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
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
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();
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

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    // Execute common query logic
    const queryResult = await executePrismaQuery({
      model: this.getModel(),
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
      includeOptions
    );

    return buildPaginatedResult(
      itemsWithRelations as ModelObject<M['model']>[],
      queryResult
    );
  }
}
