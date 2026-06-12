import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { ApiException } from '../core/exceptions';
import type {
  FilterConfig,
  MetaInput,
  OpenAPIRouteSchema,
  SearchFieldConfig,
  SearchMode,
  SearchOptions,
  SearchResult,
  SearchResultItem,
  SortSpec,
} from '../core/types';
import { SEARCH_MODES, SORT_DIRECTIONS } from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema, mergeRouteSchema } from './responses';
import {
  buildSearchConfig,
  calculateScore,
  generateHighlights,
  parseSearchFields,
  parseSearchMode,
  tokenizeQuery,
} from './search-utils';
import {
  type ListFilterParseOptions,
  type ListFilters,
  type ModelObject,
  parseListFilters,
} from './types';

/**
 * Detect a string schema across Zod 3 and Zod 4.
 *
 * Zod 3 exposed the schema kind via `_def.typeName === 'ZodString'`. Zod 4
 * reshaped its internals: `_def.type === 'string'` (and mirrored on `def`).
 * `instanceof z.ZodString` is also stable across both majors when callers
 * use the same Zod version as `hono-crud`, but the structural checks make
 * this robust to dual-Zod installs in monorepos and any future minor
 * internal drift. Tried in cheapest-first order.
 */
function isZodStringSchema(schema: unknown): boolean {
  if (schema instanceof z.ZodString) return true;
  const s = schema as
    | {
        _def?: { type?: string; typeName?: string };
        def?: { type?: string };
      }
    | null
    | undefined;
  if (!s) return false;
  return s._def?.type === 'string' || s._def?.typeName === 'ZodString' || s.def?.type === 'string';
}

/**
 * Base endpoint for full-text search with filtering, relevance scoring, and highlighting.
 * Extend this class and implement the `search` method for your ORM.
 *
 * Features:
 * - Full-text search across multiple fields
 * - Configurable field weights for relevance scoring
 * - Search modes: 'any' (OR), 'all' (AND), 'phrase' (exact match)
 * - Highlighted snippets with matched terms
 * - Combined with standard list filters, sorting, and pagination
 * - Soft delete support (excluded by default)
 *
 * @example
 * ```
 * GET /users/search?q=john&fields=name,bio&mode=any&highlight=true
 * GET /products/search?q=organic%20mango&mode=all&status=active&page=1
 * ```
 */
export abstract class SearchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  // ============================================================================
  // Search Configuration
  // ============================================================================

  /**
   * Fields that can be searched.
   * Map of field names to their configurations (weight, type).
   * If empty, defaults to all string fields in the schema.
   */
  protected searchableFields: Record<string, SearchFieldConfig> = {};

  /**
   * Simple list of searchable field names.
   * Alternative to `searchableFields` when weights aren't needed.
   * These fields will have weight 1.0.
   */
  protected searchFields: string[] = [];

  /**
   * Field weights for relevance scoring.
   * Higher values increase the field's importance in scoring.
   * Used when `searchFields` array is provided instead of `searchableFields`.
   */
  protected fieldWeights: Record<string, number> = {};

  /**
   * Default search mode when not specified in query.
   * - 'any': Match any search term (OR)
   * - 'all': Match all search terms (AND)
   * - 'phrase': Match exact phrase
   */
  protected defaultMode: SearchMode = 'any';

  /**
   * Minimum query length required to perform search.
   */
  protected minQueryLength = 2;

  /**
   * Maximum query length allowed to prevent CPU exhaustion from long search strings.
   */
  protected maxQueryLength = 500;

  /**
   * HTML tag used to wrap highlighted matches.
   */
  protected highlightTag = 'mark';

  /**
   * Maximum length of highlight snippets in characters.
   */
  protected snippetLength = 150;

  /**
   * Default minimum score threshold (0-1).
   * Results below this score are excluded.
   */
  protected defaultMinScore = 0;

  /**
   * Query parameter name used to read the search string. Defaults to `'q'`.
   * Override (or configure via `endpoints.search.paramName`) to expose a
   * different name on the wire, e.g. `'query'` for `/search?query=foo`.
   */
  protected searchParamName = 'q';

  // ============================================================================
  // Filter Configuration (reused from ListEndpoint)
  // ============================================================================

  /** Fields that can be used for filtering */
  protected filterFields: string[] = [];

  /** Filter configuration with allowed operators per field */
  protected filterConfig?: FilterConfig;

  /** Fields that can be used for sorting. Use with ?sort=fieldName */
  protected sortFields: string[] = [];

  /** Default sort configuration */
  protected defaultSort?: SortSpec;

  // ============================================================================
  // Pagination Configuration
  // ============================================================================

  /** Default items per page */
  protected defaultPerPage = 20;

  /** Maximum items per page */
  protected maxPerPage = 100;

  // ============================================================================
  // Relations Configuration
  // ============================================================================

  /** Allowed relation names that can be included via ?include=relation1,relation2 */
  protected allowedIncludes: string[] = [];

  // ============================================================================
  // Field Selection Configuration
  // ============================================================================

  /** Enable field selection via ?fields=field1,field2 */
  protected fieldSelectionEnabled = false;

  /** Fields that are allowed to be selected */
  protected allowedSelectFields: string[] = [];

  /** Fields that are never returned */
  protected blockedSelectFields: string[] = [];

  /** Fields that are always included */
  protected alwaysIncludeFields: string[] = [];

  /** Default fields to return */
  protected defaultSelectFields: string[] = [];

  // ============================================================================
  // Soft Delete
  // ============================================================================

  /**
   * Get the soft delete configuration for this model.
   */

  /**
   * Check if soft delete is enabled for this model.
   */

  // ============================================================================
  // Search Field Configuration
  // ============================================================================

  /**
   * Gets the configured searchable fields with their configurations.
   */
  protected getSearchableFields(): Record<string, SearchFieldConfig> {
    // If searchableFields is explicitly configured, use it
    if (Object.keys(this.searchableFields).length > 0) {
      return this.searchableFields;
    }

    // Otherwise, build from searchFields array and fieldWeights
    if (this.searchFields.length > 0) {
      return buildSearchConfig(this.searchFields, this.fieldWeights);
    }

    // Default to all string fields in the schema
    const schemaShape = this.getModelSchema().shape;
    const fields: Record<string, SearchFieldConfig> = {};

    for (const [key, zodType] of Object.entries(schemaShape)) {
      if (isZodStringSchema(zodType)) {
        fields[key] = { weight: 1.0 };
      }
    }

    return fields;
  }

  // ============================================================================
  // Schema Generation
  // ============================================================================

  /**
   * Returns the query parameter schema for search and filtering.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> {
    const queryParam = this.searchParamName || 'q';
    // Use Record for mutable shape building (ZodRawShape is readonly in Zod v4)
    const shape: Record<string, z.ZodTypeAny> = {
      // Search parameters — key is `searchParamName` (default `'q'`).
      [queryParam]: z
        .string()
        .min(this.minQueryLength)
        .max(this.maxQueryLength)
        .meta({ description: 'Search query' }),
      fields: z
        .string()
        .optional()
        .meta({
          description: `Comma-separated fields to search. Available: ${Object.keys(this.getSearchableFields()).join(', ')}`,
        }),
      mode: z
        .enum(SEARCH_MODES)
        .optional()
        .meta({ description: 'Search mode: any (OR), all (AND), phrase (exact)' }),
      highlight: z.enum(['true', 'false']).optional().meta({
        description: 'Include highlighted snippets',
      }),
      minScore: z.string().optional().meta({
        description: 'Minimum relevance score threshold (0-1)',
      }),

      // Pagination
      page: z.string().optional(),
      per_page: z.string().optional(),
    };

    // Sorting
    if (this.sortFields.length > 0) {
      shape.sort = z
        .enum(this.sortFields as [string, ...string[]])
        .optional()
        .meta({ description: 'Field to sort by' });
      shape.order = z.enum(SORT_DIRECTIONS).optional().meta({
        description: 'Sort direction (asc or desc)',
      });
    }

    // Filter fields
    for (const field of this.filterFields) {
      shape[field] = z.string().optional();
    }

    // Operator-based filter fields
    if (this.filterConfig) {
      for (const [field, operators] of Object.entries(this.filterConfig)) {
        for (const op of operators) {
          shape[`${field}[${op}]`] = z.string().optional();
        }
        shape[field] = z.string().optional();
      }
    }

    // Soft delete query parameters
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled && softDeleteConfig.allowQueryDeleted) {
      shape[softDeleteConfig.queryParam] = z.enum(['true', 'false']).optional();
      shape.onlyDeleted = z.enum(['true', 'false']).optional();
    }

    // Include parameter for relations
    if (this.allowedIncludes.length > 0) {
      shape.include = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of relations to include. Allowed: ${this.allowedIncludes.join(', ')}`,
        });
    }

    // Field selection
    if (this.fieldSelectionEnabled) {
      const availableFields = this.getAvailableSelectFields();
      shape['fields'] = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of fields to return. Available: ${availableFields.join(', ')}`,
        });
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the list of fields available for selection.
   */
  protected getAvailableSelectFields(): string[] {
    const schemaFields = Object.keys(this.getModelSchema().shape);
    const computedFields = this._meta.model.computedFields
      ? Object.keys(this._meta.model.computedFields)
      : [];
    const relationFields = this._meta.model.relations
      ? Object.keys(this._meta.model.relations)
      : [];

    let available = [...schemaFields, ...computedFields, ...relationFields];

    if (this.allowedSelectFields.length > 0) {
      available = available.filter((f) => this.allowedSelectFields.includes(f));
    }

    if (this.blockedSelectFields.length > 0) {
      available = available.filter((f) => !this.blockedSelectFields.includes(f));
    }

    return available;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const searchResultItemSchema = z.object({
      item: this.getModelSchema(),
      score: z.number().min(0).max(1),
      highlights: z.record(z.string(), z.array(z.string())).optional(),
      matchedFields: z.array(z.string()),
    });

    return mergeRouteSchema(
      {
        request: {
          query: this.getQuerySchema(),
        },
        responses: {
          200: {
            description: 'Search results',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.literal(true),
                  result: z.array(searchResultItemSchema),
                  result_info: z.object({
                    page: z.number(),
                    per_page: z.number(),
                    total_count: z.number().optional(),
                    total_pages: z.number().optional(),
                    query: z.string(),
                    searchedFields: z.array(z.string()),
                  }),
                }),
              },
            },
          },
          400: errorResponseSchema('Invalid search request'),
        },
      },
      this.schema,
    );
  }

  // ============================================================================
  // Query Parsing
  // ============================================================================

  /**
   * Parses search options from query parameters.
   */
  protected async getSearchOptions(): Promise<SearchOptions> {
    const { query } = await this.getValidatedData();

    const queryParam = this.searchParamName || 'q';
    const q = (query as Record<string, unknown> | undefined)?.[queryParam] as string;
    const fieldsParam = query?.fields as string | undefined;
    const mode = parseSearchMode(query?.mode as string | undefined);
    const highlight = query?.highlight === 'true';
    const minScore = query?.minScore
      ? Math.max(0, Math.min(1, Number.parseFloat(query.minScore as string) || 0))
      : this.defaultMinScore;

    const configuredFields = this.getSearchableFields();
    const fields = parseSearchFields(fieldsParam, configuredFields);

    return {
      query: q,
      fields: fields.length > 0 ? fields : Object.keys(configuredFields),
      mode: mode ?? this.defaultMode,
      highlight,
      minScore,
    };
  }

  /**
   * Parses list filters from query parameters.
   */
  protected async getFilters(): Promise<ListFilters> {
    const { query } = await this.getValidatedData();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const config: ListFilterParseOptions = {
      filterFields: this.filterFields,
      filterConfig: this.filterConfig,
      searchFields: [], // Don't use basic search, we handle it ourselves
      searchParamName: 'q',
      sortFields: this.sortFields,
      defaultSort: this.defaultSort,
      defaultPerPage: this.defaultPerPage,
      maxPerPage: this.maxPerPage,
      softDeleteQueryParam: softDeleteConfig.queryParam,
      allowedIncludes: this.allowedIncludes,
      fieldSelectionEnabled: this.fieldSelectionEnabled,
      allowedSelectFields: this.allowedSelectFields,
      blockedSelectFields: this.blockedSelectFields,
      alwaysIncludeFields: this.alwaysIncludeFields,
      defaultSelectFields: this.defaultSelectFields,
    };

    return parseListFilters(query || {}, config);
  }

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Lifecycle hook: called before search operation.
   * Override to transform search options.
   */
  async beforeSearch(options: SearchOptions): Promise<SearchOptions> {
    return options;
  }

  /**
   * Lifecycle hook: called after search operation.
   * Override to transform results before returning.
   */
  async afterSearch(
    results: SearchResultItem<ModelObject<M['model']>>[],
  ): Promise<SearchResultItem<ModelObject<M['model']>>[]> {
    return results;
  }

  // ============================================================================
  // Abstract Method
  // ============================================================================

  /**
   * Performs the search operation.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param options - Search options (query, fields, mode, etc.)
   * @param filters - List filters (pagination, sorting, additional filters)
   * @returns Search results with scores and highlights
   */
  abstract search(
    options: SearchOptions,
    filters: ListFilters,
  ): Promise<SearchResult<ModelObject<M['model']>>>;

  // ============================================================================
  // Request Handler
  // ============================================================================

  /**
   * Main handler for the search operation.
   */
  async handle(): Promise<Response> {
    // Parse search options and filters
    let searchOptions = await this.getSearchOptions();
    const filters = await this.getFilters();

    // Validate query length
    if (!searchOptions.query || searchOptions.query.length < this.minQueryLength) {
      throw new ApiException(
        `Search query must be at least ${this.minQueryLength} characters`,
        400,
        'INVALID_QUERY',
      );
    }

    // Call beforeSearch hook
    searchOptions = await this.beforeSearch(searchOptions);

    // Perform search
    const searchResult = await this.search(searchOptions, filters);

    // Call afterSearch hook
    const items = await this.afterSearch(searchResult.items);

    // computed → serializer → profile → transform → field selection, applied to
    // each result's `.item` payload. Profile + transform were previously skipped
    // here — running them closes the serialization-profile leak.
    const fieldSelection =
      this.fieldSelectionEnabled && filters.options.fields && filters.options.fields.length > 0
        ? { fields: filters.options.fields, isActive: true }
        : undefined;
    const finalized = await this.finalizeArray(
      items.map((item) => item.item),
      fieldSelection,
    );
    const result: unknown[] = items.map((item, index) => ({
      ...item,
      item: finalized[index],
    }));

    // Calculate pagination info.
    //
    // Prefer `postFilteredCount` when the adapter populates it — that
    // reflects the actual user-visible result set after in-memory
    // tokenization / minScore filtering, so pagination math matches what
    // the client receives. Adapters that already return a post-filter
    // count via `totalCount` (e.g. memory) leave `postFilteredCount`
    // unset and the legacy field is used unchanged — fully back-compat.
    const effectiveTotal = searchResult.postFilteredCount ?? searchResult.totalCount;
    const page = filters.options.page || 1;
    const perPage = filters.options.per_page || this.defaultPerPage;
    const totalPages = Math.ceil(effectiveTotal / perPage);

    return this.successPaginated(result, {
      page,
      per_page: perPage,
      total_count: effectiveTotal,
      total_pages: totalPages,
      query: searchOptions.query,
      searchedFields: searchOptions.fields || Object.keys(this.getSearchableFields()),
    });
  }
}

// ============================================================================
// Helper Functions for Implementations
// ============================================================================

/**
 * Scores and filters records in memory.
 * Useful for memory adapter and as fallback for databases without native full-text search.
 *
 * @param records - Records to search through
 * @param options - Search options
 * @param searchableFields - Field configurations for scoring
 * @returns Scored and filtered search results
 */
export function searchInMemory<T extends Record<string, unknown>>(
  records: T[],
  options: SearchOptions,
  searchableFields: Record<string, SearchFieldConfig>,
): SearchResultItem<T>[] {
  const queryTokens = tokenizeQuery(options.query, options.mode);

  // Build field config for only requested fields
  const fieldsToSearch: Record<string, SearchFieldConfig> = {};
  const requestedFields = options.fields || Object.keys(searchableFields);

  for (const field of requestedFields) {
    if (searchableFields[field]) {
      fieldsToSearch[field] = searchableFields[field];
    }
  }

  const results: SearchResultItem<T>[] = [];

  for (const record of records) {
    const { score, matchedFields } = calculateScore(
      record,
      queryTokens,
      fieldsToSearch,
      options.mode,
    );

    // Skip if below minimum score or no matches
    if (score < options.minScore || matchedFields.length === 0) {
      continue;
    }

    // Generate highlights if requested
    let highlights: Record<string, string[]> | undefined;
    if (options.highlight) {
      highlights = {};
      for (const field of matchedFields) {
        const fieldHighlights = generateHighlights(record[field], queryTokens, options.mode);
        if (fieldHighlights.length > 0) {
          highlights[field] = fieldHighlights;
        }
      }
    }

    results.push({
      item: record,
      score,
      highlights: highlights && Object.keys(highlights).length > 0 ? highlights : undefined,
      matchedFields,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}
