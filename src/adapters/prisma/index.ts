import type { Env } from 'hono';
import { CreateEndpoint } from '../../endpoints/create.js';
import { ReadEndpoint } from '../../endpoints/read.js';
import { UpdateEndpoint } from '../../endpoints/update.js';
import { DeleteEndpoint } from '../../endpoints/delete.js';
import { ListEndpoint } from '../../endpoints/list.js';
import { RestoreEndpoint } from '../../endpoints/restore.js';
import { UpsertEndpoint } from '../../endpoints/upsert.js';
import { BatchCreateEndpoint } from '../../endpoints/batch-create.js';
import { BatchUpdateEndpoint, type BatchUpdateItem } from '../../endpoints/batch-update.js';
import { BatchDeleteEndpoint } from '../../endpoints/batch-delete.js';
import { BatchRestoreEndpoint } from '../../endpoints/batch-restore.js';
import { BatchUpsertEndpoint } from '../../endpoints/batch-upsert.js';
import {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from '../../endpoints/version-history.js';
import { AggregateEndpoint, computeAggregations } from '../../endpoints/aggregate.js';
import { SearchEndpoint, searchInMemory } from '../../endpoints/search.js';
import { ExportEndpoint } from '../../endpoints/export.js';
import { ImportEndpoint } from '../../endpoints/import.js';
import type {
  MetaInput,
  PaginatedResult,
  ListFilters,
  FilterCondition,
  SearchOptions,
  SearchResult,
  AggregateOptions,
  AggregateResult,
} from '../../core/types.js';
import type { ModelObject } from '../../endpoints/types.js';

// Type for Prisma model operations
interface PrismaModelOperations {
  create: (args: { data: unknown }) => Promise<unknown>;
  findUnique: (args: { where: unknown }) => Promise<unknown>;
  findFirst: (args: { where: unknown }) => Promise<unknown>;
  findMany: (args: {
    where?: unknown;
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }) => Promise<unknown[]>;
  update: (args: { where: unknown; data: unknown }) => Promise<unknown>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
  delete: (args: { where: unknown }) => Promise<unknown>;
  deleteMany: (args: { where: unknown }) => Promise<{ count: number }>;
  count: (args?: { where?: unknown }) => Promise<number>;
  upsert: (args: { where: unknown; create: unknown; update: unknown }) => Promise<unknown>;
  createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
}

// Type for Prisma client - we use a Record type with explicit model access
// Dynamic model access requires flexibility since model names are determined at runtime
type PrismaClient = Record<string, PrismaModelOperations> & {
  $transaction: <T>(fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
};

/**
 * Converts filter conditions to Prisma where clause.
 */
function buildPrismaWhere(filters: FilterCondition[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const filter of filters) {
    switch (filter.operator) {
      case 'eq':
        where[filter.field] = filter.value;
        break;
      case 'ne':
        where[filter.field] = { not: filter.value };
        break;
      case 'gt':
        where[filter.field] = { gt: filter.value };
        break;
      case 'gte':
        where[filter.field] = { gte: filter.value };
        break;
      case 'lt':
        where[filter.field] = { lt: filter.value };
        break;
      case 'lte':
        where[filter.field] = { lte: filter.value };
        break;
      case 'in':
        where[filter.field] = { in: filter.value };
        break;
      case 'nin':
        where[filter.field] = { notIn: filter.value };
        break;
      case 'like':
        where[filter.field] = { contains: String(filter.value).replace(/%/g, '') };
        break;
      case 'ilike':
        where[filter.field] = {
          contains: String(filter.value).replace(/%/g, ''),
          mode: 'insensitive',
        };
        break;
      case 'null':
        where[filter.field] = filter.value ? null : { not: null };
        break;
      case 'between': {
        const [min, max] = filter.value as [unknown, unknown];
        where[filter.field] = { gte: min, lte: max };
        break;
      }
    }
  }

  return where;
}

/**
 * Gets the model name for Prisma from the table name.
 * Prisma uses camelCase model names by default.
 */
function getModelName(tableName: string): string {
  // Convert snake_case or kebab-case to camelCase
  return tableName
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());
}

/**
 * Prisma Create endpoint.
 */
export abstract class PrismaCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CreateEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async read(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null> {
    const model = this.getModel();

    const where: Record<string, unknown> = {
      [this.lookupField]: lookupValue,
      ...additionalFilters,
    };

    const result = await model.findFirst({ where });
    return (result as ModelObject<M['model']>) || null;
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async delete(
    lookupValue: string,
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

    // Then delete it using the primary key
    const primaryKey = this._meta.model.primaryKeys[0];
    const result = await model.delete({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
    });

    return result as ModelObject<M['model']>;
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const model = this.getModel();

    // Build where clause
    let where = buildPrismaWhere(filters.filters);

    // Apply search
    if (filters.options.search && this.searchFields.length > 0) {
      const searchConditions = this.searchFields.map((field) => ({
        [field]: { contains: filters.options.search, mode: 'insensitive' },
      }));
      where = {
        ...where,
        OR: searchConditions,
      };
    }

    // Get total count
    const totalCount = await model.count({ where });

    // Build orderBy
    let orderBy: Record<string, string> | undefined;
    if (filters.options.order_by) {
      orderBy = {
        [filters.options.order_by]: filters.options.order_by_direction || 'asc',
      };
    }

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;

    const result = await model.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return {
      result: result as ModelObject<M['model']>[],
      result_info: {
        page,
        per_page: perPage,
        total_count: totalCount,
        total_pages: Math.ceil(totalCount / perPage),
      },
    };
  }
}

/**
 * Prisma Search endpoint.
 * Provides full-text search with relevance scoring and highlighting.
 *
 * Uses Prisma's `contains` with `mode: 'insensitive'` for case-insensitive search,
 * then scores and highlights results in memory.
 *
 * Features:
 * - Case-insensitive search using Prisma's contains
 * - In-memory relevance scoring with field weights
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact)
 * - Highlighted snippets
 * - Combined with standard list filters
 *
 * @example
 * ```ts
 * class UserSearch extends PrismaSearchEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Users'], summary: 'Search users' };
 *
 *   protected searchFields = ['name', 'email', 'bio'];
 *   protected fieldWeights = { name: 2.0, bio: 1.0 };
 *   protected filterFields = ['status'];
 * }
 * ```
 */
export abstract class PrismaSearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  /**
   * Performs search on database.
   */
  override async search(
    options: SearchOptions,
    filters: ListFilters
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const model = this.getModel();

    // Build base where clause from filters
    let where = buildPrismaWhere(filters.filters);

    // Build search conditions
    const searchableFields = this.getSearchableFields();
    const fieldsToSearch = options.fields || Object.keys(searchableFields);

    const searchConditions = fieldsToSearch.map((field) => ({
      [field]: {
        contains: options.query,
        mode: 'insensitive',
      },
    }));

    // Combine with filters
    if (searchConditions.length > 0) {
      if (options.mode === 'all') {
        // AND all search conditions
        where = {
          ...where,
          AND: searchConditions,
        };
      } else {
        // OR search conditions (for 'any' and 'phrase' modes)
        where = {
          ...where,
          OR: searchConditions,
        };
      }
    }

    // Get total count
    const totalCount = await model.count({ where });

    // Build orderBy
    let orderBy: Record<string, string> | undefined;
    if (filters.options.order_by) {
      orderBy = {
        [filters.options.order_by]: filters.options.order_by_direction || 'asc',
      };
    }

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;

    const records = await model.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    });

    // Score results in memory and generate highlights
    const searchResults = searchInMemory(
      records as ModelObject<M['model']>[],
      options,
      searchableFields
    );

    return {
      items: searchResults,
      totalCount,
    };
  }
}

/**
 * Prisma Export endpoint.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class PrismaExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const model = this.getModel();

    // Build where clause
    let where = buildPrismaWhere(filters.filters);

    // Apply search
    if (filters.options.search && this.searchFields.length > 0) {
      const searchConditions = this.searchFields.map((field) => ({
        [field]: { contains: filters.options.search, mode: 'insensitive' },
      }));
      where = {
        ...where,
        OR: searchConditions,
      };
    }

    // Get total count
    const totalCount = await model.count({ where });

    // Build orderBy
    let orderBy: Record<string, string> | undefined;
    if (filters.options.order_by) {
      orderBy = {
        [filters.options.order_by]: filters.options.order_by_direction || 'asc',
      };
    }

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;

    const result = await model.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return {
      result: result as ModelObject<M['model']>[],
      result_info: {
        page,
        per_page: perPage,
        total_count: totalCount,
        total_pages: Math.ceil(totalCount / perPage),
      },
    };
  }
}

/**
 * Prisma Import endpoint.
 * Imports data from CSV or JSON with support for create and upsert modes.
 */
export abstract class PrismaImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ImportEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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
}

/**
 * Prisma Upsert endpoint.
 * Creates a record if it doesn't exist, updates it if it does.
 *
 * Supports native Prisma upsert via `useNativeUpsert = true` for atomic operations.
 *
 * @example
 * ```ts
 * class UserUpsert extends PrismaUpsertEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Users'], summary: 'Upsert user' };
 *
 *   // Use native Prisma upsert for atomic operation
 *   protected useNativeUpsert = true;
 *
 *   // Upsert by email
 *   protected upsertKeys = ['email'];
 * }
 * ```
 */
export abstract class PrismaUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpsertEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = false;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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
   * Performs a native Prisma upsert operation.
   *
   * Uses Prisma's built-in `upsert` method for atomic create-or-update.
   *
   * Note: This method cannot accurately determine if the record was created or updated.
   * The `created` flag is set to `false` by default.
   */
  protected override async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const model = this.getModel();
    const upsertKeys = this.getUpsertKeys();
    const primaryKey = this._meta.model.primaryKeys[0];

    // Build where clause from upsert keys
    const where: Record<string, unknown> = {};
    for (const key of upsertKeys) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        where[key] = value;
      }
    }

    // Build create data with generated UUID
    const createData = {
      ...data,
      [primaryKey]: (data as Record<string, unknown>)[primaryKey] || crypto.randomUUID(),
    };

    // Build update data - exclude upsert keys and primary key, filter create-only fields
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
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

    return {
      data: result as ModelObject<M['model']>,
      created: false, // Cannot determine with native upsert
    };
  }
}

/**
 * Prisma Batch Upsert endpoint.
 * Creates or updates multiple records in a single request.
 *
 * Supports native Prisma upsert via `useNativeUpsert = true` for atomic operations.
 * Note: Prisma doesn't have a native batch upsert, so this uses individual upsert calls
 * within a transaction for atomicity.
 *
 * @example
 * ```ts
 * class ProductBatchUpsert extends PrismaBatchUpsertEndpoint<Env, typeof productMeta> {
 *   _meta = productMeta;
 *   prisma = prisma;
 *   schema = { tags: ['Products'], summary: 'Batch upsert products' };
 *
 *   // Use native Prisma upsert for atomic operation
 *   protected useNativeUpsert = true;
 *
 *   // Upsert by SKU
 *   protected upsertKeys = ['sku'];
 * }
 * ```
 */
export abstract class PrismaBatchUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BatchUpsertEndpoint<E, M> {
  abstract prisma: PrismaClient;
  protected useTransaction: boolean = true;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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
   *
   * Note: Prisma doesn't have a native batch upsert method, so this executes
   * individual upsert operations. When useTransaction is true (default), all
   * operations are wrapped in a transaction for atomicity.
   */
  protected override async nativeBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async batchCreate(
    items: Partial<ModelObject<M['model']>>[]
  ): Promise<ModelObject<M['model']>[]> {
    const model = this.getModel();
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[]
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const updated: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    // Process each update individually
    for (const item of items) {
      // Build where clause
      const where: Record<string, unknown> = {
        [this.lookupField]: item.id,
      };

      // Filter out soft-deleted records
      if (softDeleteConfig.enabled) {
        where[softDeleteConfig.field] = null;
      }

      // Find the record first
      const existing = await model.findFirst({ where });
      if (!existing) {
        notFound.push(item.id);
        continue;
      }

      // Update using primary key
      const primaryKey = this._meta.model.primaryKeys[0];
      const result = await model.update({
        where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async batchDelete(
    ids: string[]
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const deleted: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    for (const id of ids) {
      // Build where clause
      const where: Record<string, unknown> = {
        [this.lookupField]: id,
      };

      // For soft delete, exclude already-deleted records
      if (softDeleteConfig.enabled) {
        where[softDeleteConfig.field] = null;
      }

      // Find the record first
      const existing = await model.findFirst({ where });
      if (!existing) {
        notFound.push(id);
        continue;
      }

      const primaryKey = this._meta.model.primaryKeys[0];

      if (softDeleteConfig.enabled) {
        // Soft delete: set the deletion timestamp
        const result = await model.update({
          where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
          data: { [softDeleteConfig.field]: new Date() },
        });
        deleted.push(result as ModelObject<M['model']>);
      } else {
        // Hard delete: actually remove the record
        const result = await model.delete({
          where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
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

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async batchRestore(
    ids: string[]
  ): Promise<{ restored: ModelObject<M['model']>[]; notFound: string[] }> {
    const model = this.getModel();
    const softDeleteConfig = this.getSoftDeleteConfig();
    const restored: ModelObject<M['model']>[] = [];
    const notFound: string[] = [];

    for (const id of ids) {
      // Build where clause - only find records that are actually deleted
      const where: Record<string, unknown> = {
        [this.lookupField]: id,
        [softDeleteConfig.field]: { not: null },
      };

      // Find the deleted record
      const existing = await model.findFirst({ where });
      if (!existing) {
        notFound.push(id);
        continue;
      }

      // Restore by setting deletedAt to null
      const primaryKey = this._meta.model.primaryKeys[0];
      const result = await model.update({
        where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
        data: { [softDeleteConfig.field]: null },
      });

      restored.push(result as ModelObject<M['model']>);
    }

    return { restored, notFound };
  }
}

/**
 * Prisma Version History endpoint.
 * Lists all versions for a record.
 */
export abstract class PrismaVersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionHistoryEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  protected override async recordExists(lookupValue: string): Promise<boolean> {
    const model = this.getModel();

    const count = await model.count({
      where: { [this.lookupField]: lookupValue },
    });

    return count > 0;
  }
}

/**
 * Prisma Version Read endpoint.
 * Gets a specific version of a record.
 */
export abstract class PrismaVersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionReadEndpoint<E, M> {}

/**
 * Prisma Version Compare endpoint.
 * Compares two versions of a record.
 */
export abstract class PrismaVersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionCompareEndpoint<E, M> {}

/**
 * Prisma Version Rollback endpoint.
 * Rolls back a record to a previous version.
 */
export abstract class PrismaVersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionRollbackEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number
  ): Promise<ModelObject<M['model']>> {
    const model = this.getModel();
    const versionField = this.getVersioningConfig().field;
    const primaryKey = this._meta.model.primaryKeys[0];

    // Find the existing record
    const existing = await model.findFirst({
      where: { [this.lookupField]: lookupValue },
    });

    if (!existing) {
      throw new Error(`Record not found: ${lookupValue}`);
    }

    // Update the record with version data and new version number
    const result = await model.update({
      where: { [primaryKey]: (existing as Record<string, unknown>)[primaryKey] },
      data: {
        ...versionData,
        [versionField]: newVersion,
      },
    });

    return result as ModelObject<M['model']>;
  }
}

/**
 * Prisma Aggregate endpoint.
 * Computes aggregations (COUNT, SUM, AVG, MIN, MAX) with GROUP BY support.
 */
export abstract class PrismaAggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends AggregateEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel() {
    const modelName = getModelName(this._meta.model.tableName);
    return this.prisma[modelName];
  }

  override async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const model = this.getModel();

    // Build where clause
    let where: Record<string, unknown> = {};

    // Apply soft delete filter
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled) {
      const { query } = await this.getValidatedData();
      const withDeleted = query?.withDeleted === true || query?.withDeleted === 'true';

      if (!withDeleted) {
        where[softDeleteConfig.field] = null;
      }
    }

    // Apply filters
    if (options.filters) {
      for (const [field, value] of Object.entries(options.filters)) {
        if (typeof value === 'object' && value !== null) {
          // Operator syntax - convert to Prisma format
          const prismaCondition: Record<string, unknown> = {};
          for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
            switch (op) {
              case 'eq':
                prismaCondition.equals = opValue;
                break;
              case 'ne':
                prismaCondition.not = opValue;
                break;
              case 'gt':
                prismaCondition.gt = opValue;
                break;
              case 'gte':
                prismaCondition.gte = opValue;
                break;
              case 'lt':
                prismaCondition.lt = opValue;
                break;
              case 'lte':
                prismaCondition.lte = opValue;
                break;
              case 'in':
                prismaCondition.in = opValue;
                break;
              case 'nin':
                prismaCondition.notIn = opValue;
                break;
              default:
                prismaCondition[op] = opValue;
            }
          }
          where[field] = prismaCondition;
        } else {
          // Simple equality
          where[field] = value;
        }
      }
    }

    // For complex aggregations with GROUP BY, HAVING, etc., we fetch records
    // and use the in-memory computeAggregations helper.
    // This ensures consistent behavior across all databases.
    const records = await model.findMany({ where });

    return computeAggregations(records as Record<string, unknown>[], options);
  }
}
