import type { Env } from 'hono';
import type {
  MetaInput,
  FilterCondition,
  PaginatedResult,
} from '../../core/types';
import type { ModelObject } from '../../endpoints/types';
import { NLQueryEndpoint } from '../../ai/nl-query/endpoint';
import { RAGEndpoint } from '../../ai/rag/endpoint';
import { getStore } from './helpers';

/**
 * Memory-based NL Query endpoint.
 * Translates natural language into filters and queries the in-memory store.
 */
export abstract class MemoryNLQueryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends NLQueryEndpoint<E, M> {
  override async list(
    filters: FilterCondition[],
    sort: { field: string; direction: 'asc' | 'desc' } | undefined,
    page: number,
    perPage: number
  ): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let items = Array.from(store.values());

    // Apply filters
    for (const filter of filters) {
      items = items.filter((item) => {
        const value = (item as Record<string, unknown>)[filter.field];

        switch (filter.operator) {
          case 'eq':
            return String(value) === String(filter.value);
          case 'ne':
            return String(value) !== String(filter.value);
          case 'gt':
            return Number(value) > Number(filter.value);
          case 'gte':
            return Number(value) >= Number(filter.value);
          case 'lt':
            return Number(value) < Number(filter.value);
          case 'lte':
            return Number(value) <= Number(filter.value);
          case 'in':
            return (filter.value as unknown[]).map(String).includes(String(value));
          case 'nin':
            return !(filter.value as unknown[]).map(String).includes(String(value));
          case 'like':
            return String(value).includes(String(filter.value).replace(/%/g, ''));
          case 'ilike':
            return String(value)
              .toLowerCase()
              .includes(String(filter.value).replace(/%/g, '').toLowerCase());
          case 'null':
            return filter.value ? value === null : value !== null;
          case 'between': {
            const [min, max] = filter.value as [unknown, unknown];
            return Number(value) >= Number(min) && Number(value) <= Number(max);
          }
          default:
            return true;
        }
      });
    }

    const totalCount = items.length;

    // Apply sorting
    if (sort) {
      const direction = sort.direction === 'desc' ? -1 : 1;
      items.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sort.field] as string | number;
        const bVal = (b as Record<string, unknown>)[sort.field] as string | number;
        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }

    // Paginate
    const start = (page - 1) * perPage;
    const paginatedItems = items.slice(start, start + perPage);
    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: paginatedItems,
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
 * Memory-based RAG endpoint.
 * Retrieves all records from the in-memory store for AI context.
 */
export abstract class MemoryRAGEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends RAGEndpoint<E, M> {
  override async retrieve(_question: string): Promise<ModelObject<M['model']>[]> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    return Array.from(store.values());
  }
}
