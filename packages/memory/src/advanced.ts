import type { Env } from 'hono';
import { CloneEndpoint } from 'hono-crud/internal';
import { UpsertEndpoint } from 'hono-crud/internal';
import {
  VersionCompareEndpoint,
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionRollbackEndpoint,
} from 'hono-crud/internal';
import { AggregateEndpoint, computeAggregations } from 'hono-crud/internal';
import { SearchEndpoint, searchInMemory } from 'hono-crud/internal';
import { ExportEndpoint } from 'hono-crud/internal';
import { ImportEndpoint } from 'hono-crud/internal';
import { BulkPatchEndpoint } from 'hono-crud/internal';
import type {
  AggregateOptions,
  AggregateResult,
  IncludeOptions,
  ListFilters,
  MetaInput,
  NestedUpdateInput,
  NestedWriteResult,
  PaginatedResult,
  RelationConfig,
  SearchOptions,
  SearchResult,
} from 'hono-crud/internal';
import type { ModelObject } from 'hono-crud/internal';
import { applyUpsertRestore, isFilterOperator } from 'hono-crud/internal';
import { matchesFilter } from './filter';
import { findByUpsertKeys, getStore, loadRelations, queryMemoryStore } from './helpers';
import { isVisible } from './visibility';

/**
 * Memory-based Clone endpoint for testing.
 * Duplicates a record with optional overrides.
 */
export abstract class MemoryCloneEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CloneEndpoint<E, M> {
  /**
   * Generates a unique ID for the cloned record.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  async findSource(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const existing = store.get(lookupValue);
    const softDeleteConfig = this.getSoftDeleteConfig();

    if (!existing) return null;

    if (!isVisible(existing, softDeleteConfig, additionalFilters)) {
      return null;
    }

    return existing;
  }

  async createClone(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const pk = this._meta.model.primaryKeys[0];

    // Base CloneEndpoint already stripped the source PK, so the managed
    // resolver always fills it. `generateId()` stays the overridable
    // default-branch generator; `id:'database'` throws (memory has no DB).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory', () =>
      this.generateId(),
    ) as ModelObject<M['model']>;

    const id = String((record as Record<string, unknown>)[pk]);
    store.set(id, record);
    return record;
  }
}

/**
 * Memory-based Upsert endpoint for testing.
 * Creates a record if it doesn't exist, updates it if it does.
 */
export abstract class MemoryUpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends UpsertEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Finds an existing record by upsert keys.
   */
  async findExisting(
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    return findByUpsertKeys(store, data as Record<string, unknown>, this.getUpsertKeys());
  }

  /**
   * Creates a new record.
   */
  async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    // `generateId()` stays the overridable default-branch generator;
    // `id:'database'` throws here (memory has no database).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory', () =>
      this.generateId(),
    ) as ModelObject<M['model']>;

    store.set(String((record as Record<string, unknown>)[primaryKey]), record);
    return record;
  }

  /**
   * Updates an existing record.
   */
  async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const id = String((existing as Record<string, unknown>)[primaryKey]);

    // Merge existing with new data (+ managed updatedAt bump).
    const updated = {
      ...existing,
      ...this.applyManagedUpdateFields(data as Record<string, unknown>),
    } as ModelObject<M['model']>;

    store.set(id, updated);
    return updated;
  }

  /**
   * Performs a native upsert operation.
   * For in-memory storage, this is implemented as an atomic find-and-update/create.
   *
   * Note: Unlike database native upsert, this can accurately determine if the record
   * was created or updated.
   */
  protected async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    _tx?: unknown,
  ): Promise<{ data: ModelObject<M['model']>; created: boolean }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Match-and-restore: soft-deleted matches are updated and un-deleted
    // (see core's applyUpsertRestore), same as the standard upsert path.
    const existingRecord = findByUpsertKeys(
      store,
      data as Record<string, unknown>,
      this.getUpsertKeys(),
    );

    if (existingRecord) {
      // Update existing record - filter out create-only fields
      const updateData = { ...data };
      if (this.createOnlyFields) {
        for (const field of this.createOnlyFields) {
          delete updateData[field as keyof typeof updateData];
        }
      }

      const id = String((existingRecord as Record<string, unknown>)[primaryKey]);
      const updated = {
        ...existingRecord,
        ...applyUpsertRestore(
          this.applyManagedUpdateFields(updateData as Record<string, unknown>),
          existingRecord as Record<string, unknown>,
          this.getSoftDeleteConfig(),
        ),
      } as ModelObject<M['model']>;

      store.set(id, updated);
      return { data: updated, created: false };
    } else {
      // Create new record - filter out update-only fields
      const createData = { ...data };
      if (this.updateOnlyFields) {
        for (const field of this.updateOnlyFields) {
          delete createData[field as keyof typeof createData];
        }
      }

      // Resolve managed write-time fields (Model.id strategy + timestamps).
      const record = this.applyManagedInsertFields(
        createData as Record<string, unknown>,
        'memory',
        () => this.generateId(),
      ) as ModelObject<M['model']>;

      const id = String((record as Record<string, unknown>)[primaryKey]);
      store.set(id, record);
      return { data: record, created: true };
    }
  }

  /**
   * Processes nested write operations.
   */
  protected async processNestedWrites(
    parentId: string | number,
    _relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
  ): Promise<NestedWriteResult> {
    const relatedStore = getStore<Record<string, unknown>>(relationConfig.model);
    const result: NestedWriteResult = {
      created: [],
      updated: [],
      deleted: [],
      connected: [],
      disconnected: [],
    };

    // Process create operations
    if (operations.create) {
      const items = Array.isArray(operations.create) ? operations.create : [operations.create];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const record = {
          ...item,
          id: crypto.randomUUID(),
          [relationConfig.foreignKey]: parentId,
        };
        relatedStore.set(record.id, record);
        result.created.push(record);
      }
    }

    // Process update operations
    if (operations.update) {
      for (const item of operations.update) {
        const id = String(item.id);
        const existing = relatedStore.get(id);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          const updated = { ...existing, ...item };
          relatedStore.set(id, updated);
          result.updated.push(updated);
        }
      }
    }

    // Process delete operations
    if (operations.delete) {
      for (const id of operations.delete) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          relatedStore.delete(idStr);
          result.deleted.push(id);
        }
      }
    }

    // Process connect operations
    if (operations.connect) {
      for (const id of operations.connect) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing) {
          const connected = { ...existing, [relationConfig.foreignKey]: parentId };
          relatedStore.set(idStr, connected);
          result.connected.push(id);
        }
      }
    }

    // Process disconnect operations
    if (operations.disconnect) {
      for (const id of operations.disconnect) {
        const idStr = String(id);
        const existing = relatedStore.get(idStr);
        if (existing && existing[relationConfig.foreignKey] === parentId) {
          const disconnected = { ...existing, [relationConfig.foreignKey]: null };
          relatedStore.set(idStr, disconnected);
          result.disconnected.push(id);
        }
      }
    }

    return result;
  }
}

/**
 * Memory-based Version History endpoint for testing.
 * Lists all versions for a record.
 */
export abstract class MemoryVersionHistoryEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionHistoryEndpoint<E, M> {
  /**
   * Checks if the parent record exists.
   */
  protected async recordExists(lookupValue: string): Promise<boolean> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    return store.has(lookupValue);
  }
}

/**
 * Memory-based Version Read endpoint for testing.
 * Gets a specific version of a record.
 */
export abstract class MemoryVersionReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionReadEndpoint<E, M> {}

/**
 * Memory-based Version Compare endpoint for testing.
 * Compares two versions of a record.
 */
export abstract class MemoryVersionCompareEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionCompareEndpoint<E, M> {}

/**
 * Memory-based Version Rollback endpoint for testing.
 * Rolls back a record to a previous version.
 */
export abstract class MemoryVersionRollbackEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends VersionRollbackEndpoint<E, M> {
  /**
   * Rolls back the record to the specified version data.
   */
  async rollback(
    lookupValue: string,
    versionData: Record<string, unknown>,
    newVersion: number,
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const versionField = this.getVersioningConfig().field;

    // Create updated record with version data and new version number
    const updated = {
      ...versionData,
      [versionField]: newVersion,
    } as ModelObject<M['model']>;

    store.set(lookupValue, updated);
    return updated;
  }
}

/**
 * Memory-based Aggregate endpoint for testing.
 * Computes aggregations (COUNT, SUM, AVG, MIN, MAX) with GROUP BY support.
 */
export abstract class MemoryAggregateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends AggregateEndpoint<E, M> {
  /**
   * Performs aggregation on in-memory data.
   */
  async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let records = Array.from(store.values()) as Record<string, unknown>[];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter (default: exclude deleted)
    if (softDeleteConfig.enabled) {
      const { query } = await this.getValidatedData();
      const withDeleted = query?.withDeleted === true || query?.withDeleted === 'true';

      if (!withDeleted) {
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt === null || deletedAt === undefined;
        });
      }
    }

    // Apply filters. All operator handling delegates to `matchesFilter` (the
    // single source of truth shared with list/search/export), which fails CLOSED
    // on unknown operators. We adapt the aggregate `{ field: { op: value } }`
    // shape into the `FilterCondition` shape it expects; an operator that isn't a
    // recognized `FilterOperator` (e.g. from untrusted input) matches nothing
    // rather than every record.
    if (options.filters) {
      for (const [field, value] of Object.entries(options.filters)) {
        records = records.filter((record) => {
          const recordValue = record[field];
          // Operator syntax: { field: { op: value } }
          if (typeof value === 'object' && value !== null) {
            return Object.entries(value as Record<string, unknown>).every(([op, opValue]) => {
              if (!isFilterOperator(op)) return false;
              return matchesFilter(recordValue, { field, operator: op, value: opValue });
            });
          }
          // Simple equality
          return matchesFilter(recordValue, { field, operator: 'eq', value });
        });
      }
    }

    // Use the helper function to compute aggregations
    return computeAggregations(records, options);
  }
}

/**
 * Memory-based Search endpoint for testing.
 * Provides full-text search with relevance scoring and highlighting.
 *
 * Features:
 * - TF-IDF-like relevance scoring
 * - Configurable field weights
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact)
 * - Highlighted snippets
 * - Combined with standard list filters
 *
 * @example
 * ```ts
 * class UserSearch extends MemorySearchEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Search users' };
 *
 *   protected searchFields = ['name', 'email', 'bio'];
 *   protected fieldWeights = { name: 2.0, bio: 1.0 };
 *   protected filterFields = ['status', 'role'];
 * }
 * ```
 */
export abstract class MemorySearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends SearchEndpoint<E, M> {
  /**
   * Performs search on in-memory data.
   */
  async search(
    options: SearchOptions,
    filters: ListFilters,
  ): Promise<SearchResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    let records = Array.from(store.values()) as Record<string, unknown>[];
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Apply soft delete filter
    if (softDeleteConfig.enabled) {
      if (filters.options.onlyDeleted) {
        // Show only deleted records
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt !== null && deletedAt !== undefined;
        });
      } else if (!filters.options.withDeleted) {
        // Default: exclude deleted records
        records = records.filter((record) => {
          const deletedAt = record[softDeleteConfig.field];
          return deletedAt === null || deletedAt === undefined;
        });
      }
    }

    // Apply filters
    for (const filter of filters.filters) {
      records = records.filter((record) => {
        const value = record[filter.field];
        return matchesFilter(value, filter);
      });
    }

    // Perform search and scoring.
    //
    // For mode='all' we apply a token-AND across fields ourselves before
    // delegating to `searchInMemory`: each token must be present in AT LEAST
    // ONE configured field. This matches the documented "all terms match"
    // intent (rather than "every field contains the whole phrase").
    //
    // After pre-filtering we score with mode='any' so the scorer doesn't
    // re-apply its stricter per-field "all tokens in same field" gate.
    //
    // SECURITY: matching uses native String#includes — `%` and `_` from the
    // user query are treated as literal characters (no LIKE semantics on the
    // in-memory adapter). This mirrors the SQL adapters' explicit wildcard
    // escaping.
    const searchableFields = this.getSearchableFields();
    let recordsForScoring = records as ModelObject<M['model']>[];
    let scoringOptions = options;

    if (options.mode === 'all') {
      const tokens = options.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      const fieldsToSearch = options.fields || Object.keys(searchableFields);

      if (tokens.length > 0) {
        recordsForScoring = recordsForScoring.filter((record) => {
          const rec = record as Record<string, unknown>;
          return tokens.every((token) =>
            fieldsToSearch.some((field) => {
              const value = rec[field];
              if (value === undefined || value === null) return false;
              const content = Array.isArray(value) ? value.join(' ') : String(value);
              return content.toLowerCase().includes(token);
            }),
          );
        });
      }

      // Score with 'any' to avoid the scorer's stricter per-field gate.
      scoringOptions = { ...options, mode: 'any' };
    }

    const searchResults = searchInMemory(recordsForScoring, scoringOptions, searchableFields);

    const totalCount = searchResults.length;

    // Apply sorting (by score by default, or by specified field)
    if (filters.options.order_by) {
      const orderBy = filters.options.order_by;
      const direction = filters.options.order_by_direction === 'desc' ? -1 : 1;

      searchResults.sort((a, b) => {
        const aVal = (a.item as Record<string, unknown>)[orderBy] as string | number;
        const bVal = (b.item as Record<string, unknown>)[orderBy] as string | number;

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }
    // Note: searchInMemory already sorts by score if no order_by

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const start = (page - 1) * perPage;
    const paginatedResults = searchResults.slice(start, start + perPage);

    // Load relations if requested
    const includeOptions: IncludeOptions = {
      relations: filters.options.include || [],
      // Owner-scope the included relations exactly as List/Read do — without
      // this, `?include=` on search/export loads related rows cross-tenant even
      // though the parent rows are scoped (the multi-tenant include-leak class).
      scope: this.getRelationScope(filters.options.withDeleted),
    };
    const resultsWithRelations = paginatedResults.map((result) => ({
      ...result,
      item: loadRelations(
        result.item as Record<string, unknown>,
        this._meta,
        includeOptions,
      ) as ModelObject<M['model']>,
    }));

    return {
      items: resultsWithRelations,
      totalCount,
    };
  }
}

/**
 * Memory-based Export endpoint for testing.
 * Exports data in CSV or JSON format with support for filtering and field selection.
 */
export abstract class MemoryExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ExportEndpoint<E, M> {
  async list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const items = queryMemoryStore(store, filters, this.searchFields, this.getSoftDeleteConfig());
    const totalCount = items.length;

    // Apply pagination
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const start = (page - 1) * perPage;
    const paginatedItems = items.slice(start, start + perPage);

    // Load relations if requested
    const includeOptions: IncludeOptions = {
      relations: filters.options.include || [],
      // Owner-scope the included relations exactly as List/Read do — without
      // this, `?include=` on search/export loads related rows cross-tenant even
      // though the parent rows are scoped (the multi-tenant include-leak class).
      scope: this.getRelationScope(filters.options.withDeleted),
    };
    const itemsWithRelations = paginatedItems.map(
      (item) =>
        loadRelations(item as Record<string, unknown>, this._meta, includeOptions) as ModelObject<
          M['model']
        >,
    );

    const totalPages = Math.ceil(totalCount / perPage);

    return {
      result: itemsWithRelations,
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
 * Memory-based Import endpoint for testing.
 * Imports data from CSV or JSON with support for create and upsert modes.
 */
export abstract class MemoryImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ImportEndpoint<E, M> {
  /**
   * Generates a unique ID for new records.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Finds an existing record by upsert keys.
   */
  async findExisting(
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']> | null> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    return findByUpsertKeys(store, data as Record<string, unknown>, this.getUpsertKeys());
  }

  /**
   * Creates a new record.
   */
  async create(data: Partial<ModelObject<M['model']>>): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];

    // Resolve managed write-time fields (Model.id strategy + timestamps).
    // `generateId()` stays the overridable default-branch generator;
    // `id:'database'` throws here (memory has no database).
    const record = this.applyManagedInsertFields(data as Record<string, unknown>, 'memory', () =>
      this.generateId(),
    ) as ModelObject<M['model']>;

    store.set(String((record as Record<string, unknown>)[primaryKey]), record);
    return record;
  }

  /**
   * Updates an existing record.
   */
  async update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
  ): Promise<ModelObject<M['model']>> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const id = String((existing as Record<string, unknown>)[primaryKey]);

    // Merge existing with new data (+ managed updatedAt bump).
    const updated = {
      ...existing,
      ...this.applyManagedUpdateFields(data as Record<string, unknown>),
    } as ModelObject<M['model']>;

    store.set(id, updated);
    return updated;
  }
}

// ============================================================================
// Memory-based Bulk Patch endpoint
// ============================================================================

export abstract class MemoryBulkPatchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends BulkPatchEndpoint<E, M> {
  async countMatching(filters: ListFilters): Promise<number> {
    const items = this.getFilteredItems(filters);
    return items.length;
  }

  async applyPatch(
    data: Partial<ModelObject<M['model']>>,
    filters: ListFilters,
  ): Promise<{ updated: number; records?: ModelObject<M['model']>[] }> {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const primaryKey = this._meta.model.primaryKeys[0];
    const items = this.getFilteredItems(filters);
    const updated: ModelObject<M['model']>[] = [];

    for (const item of items) {
      const id = String((item as Record<string, unknown>)[primaryKey]);
      // Merge patch data with the managed `updatedAt` bump — same semantics
      // as MemoryUpdate/MemoryBatchUpdate.
      const patched = {
        ...item,
        ...this.applyManagedUpdateFields(data as Record<string, unknown>),
      } as ModelObject<M['model']>;
      store.set(id, patched);
      updated.push(patched);
    }

    return { updated: updated.length, records: updated };
  }

  private getFilteredItems(filters: ListFilters): ModelObject<M['model']>[] {
    const store = getStore<ModelObject<M['model']>>(this._meta.model.tableName);
    const softDeleteConfig = this.getSoftDeleteConfig();

    // Soft-deleted records are never bulk-patched — same visibility rule as
    // every other memory write path.
    let items = Array.from(store.values()).filter((item) => isVisible(item, softDeleteConfig));

    for (const filter of filters.filters) {
      items = items.filter((item) => {
        const value = (item as Record<string, unknown>)[filter.field];
        return matchesFilter(value, filter);
      });
    }

    return items;
  }
}
