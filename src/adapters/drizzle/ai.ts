import type { Env } from 'hono';
import { and, asc, desc, sql } from 'drizzle-orm';
import type { SQL, Table, Column } from 'drizzle-orm';
import type {
  MetaInput,
  FilterCondition,
  PaginatedResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { NLQueryEndpoint } from '../../ai/nl-query/endpoint';
import { RAGEndpoint } from '../../ai/rag/endpoint';
import {
  type DrizzleDatabase,
  cast,
  getTable,
  getColumn,
  buildWhereCondition,
} from './helpers';

/**
 * Drizzle-based NL Query endpoint.
 * Translates natural language into filters and queries the database via Drizzle.
 */
export abstract class DrizzleNLQueryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends NLQueryEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  protected getColumnRef(field: string): Column {
    return getColumn(this.getTable(), field);
  }

  override async list(
    filters: FilterCondition[],
    sort: { field: string; direction: 'asc' | 'desc' } | undefined,
    page: number,
    perPage: number
  ): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const table = this.getTable();
    const conditions: SQL[] = [];

    // Apply filters
    for (const filter of filters) {
      const condition = buildWhereCondition(table, filter);
      if (condition) {
        conditions.push(condition);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const db = this.getDb();
    const countResult = await cast(db)
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(whereClause);

    const totalCount = Number((countResult as { count: number }[])[0]?.count) || 0;

    // Build main query
    let query = cast(db).select().from(table).where(whereClause);

    // Apply sorting
    if (sort) {
      const orderColumn = this.getColumnRef(sort.field);
      const orderFn = sort.direction === 'desc' ? desc : asc;
      query = query.orderBy(orderFn(orderColumn));
    }

    // Apply pagination
    query = query.limit(perPage).offset((page - 1) * perPage);

    const result = await query;
    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: result as ModelObject<M['model']>[],
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
 * Drizzle-based RAG endpoint.
 * Retrieves records from the database for AI context.
 */
export abstract class DrizzleRAGEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RAGEndpoint<E, M> {
  /** Drizzle database instance */
  db?: DrizzleDatabase;

  protected getDb(): DrizzleDatabase {
    if (this.db) return this.db;
    const contextDb = this.context?.get?.('db' as never);
    if (contextDb) return contextDb as DrizzleDatabase;
    throw new Error('Database not configured. Set db property or use middleware.');
  }

  protected getTable(): Table {
    return getTable(this._meta);
  }

  override async retrieve(_question: string): Promise<ModelObject<M['model']>[]> {
    const table = this.getTable();
    const db = this.getDb();
    const maxRecords = this.ragConfig.maxContextRecords ?? 50;

    const result = await cast(db)
      .select()
      .from(table)
      .limit(maxRecords);

    return result as ModelObject<M['model']>[];
  }
}
