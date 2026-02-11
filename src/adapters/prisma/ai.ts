import type { Env } from 'hono';
import type {
  MetaInput,
  FilterCondition,
  PaginatedResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { NLQueryEndpoint } from '../../ai/nl-query/endpoint';
import { RAGEndpoint } from '../../ai/rag/endpoint';
import {
  type PrismaClient,
  type PrismaModelOperations,
  getPrismaModel,
  buildPrismaWhere,
} from './helpers';

/**
 * Prisma-based NL Query endpoint.
 * Translates natural language into filters and queries the database via Prisma.
 */
export abstract class PrismaNLQueryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends NLQueryEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async list(
    filters: FilterCondition[],
    sort: { field: string; direction: 'asc' | 'desc' } | undefined,
    page: number,
    perPage: number
  ): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const model = this.getModel();
    const where = buildPrismaWhere(filters);

    // Build orderBy
    const orderBy = sort
      ? { [sort.field]: sort.direction }
      : undefined;

    // Execute query
    const [records, totalCount] = await Promise.all([
      model.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      model.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: records as ModelObject<M['model']>[],
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
 * Prisma-based RAG endpoint.
 * Retrieves records from the database for AI context.
 */
export abstract class PrismaRAGEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RAGEndpoint<E, M> {
  abstract prisma: PrismaClient;

  protected getModel(): PrismaModelOperations {
    return getPrismaModel(this.prisma, this._meta.model.tableName);
  }

  override async retrieve(_question: string): Promise<ModelObject<M['model']>[]> {
    const model = this.getModel();
    const maxRecords = this.ragConfig.maxContextRecords ?? 50;

    const records = await model.findMany({
      take: maxRecords,
    });

    return records as ModelObject<M['model']>[];
  }
}
