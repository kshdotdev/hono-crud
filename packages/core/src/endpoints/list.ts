import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { ConfigurationException } from '../core/exceptions';
import type {
  FilterConfig,
  MetaInput,
  OpenAPIRouteSchema,
  PaginatedResult,
  SortSpec,
} from '../core/types';
import { SORT_DIRECTIONS } from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema } from './responses';
import {
  type ListFilterParseOptions,
  type ListFilters,
  type ModelObject,
  parseListFilters,
} from './types';

/**
 * Base endpoint for listing resources with filtering, sorting, and pagination.
 * Extend this class and implement the `list` method for your ORM.
 *
 * Supports soft delete filtering when the model has `softDelete` configured.
 * When soft delete is enabled:
 * - By default, soft-deleted records are excluded
 * - Use `?withDeleted=true` to include deleted records
 * - Use `?onlyDeleted=true` to show only deleted records
 */
export abstract class ListEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  // Filter configuration
  protected filterFields: string[] = [];
  protected filterConfig?: FilterConfig;

  // Search configuration
  protected searchFields: string[] = [];
  protected searchFieldName = 'search';

  // Sorting configuration
  /** Fields that can be used for sorting. Use with ?sort=fieldName */
  protected sortFields: string[] = [];
  /** Default sort configuration */
  protected defaultSort?: SortSpec;

  // Pagination configuration
  protected defaultPerPage = 20;
  protected maxPerPage = 100;

  /**
   * Enable cursor-based pagination.
   * When enabled, clients can use `?cursor=xxx&limit=N` alongside standard page/per_page.
   * The cursor is an opaque base64-encoded string encoding the boundary item's
   * cursor field; walks are next-only (Stripe-style, no prev_cursor).
   *
   * During a cursor walk, results are always ordered by {@link cursorField}
   * ascending — user `sort`/`order` parameters are ignored.
   *
   * Requires an adapter whose `list` implements the keyset window
   * ({@link supportsCursorPagination}); enabling it on an adapter without
   * support throws a loud `ConfigurationException` at request time instead of
   * silently falling back to offset pagination.
   */
  protected cursorPaginationEnabled = false;

  /**
   * Whether the adapter's `list` implementation supports keyset cursor
   * pagination. Declared by adapter List endpoints (memory/drizzle/prisma all
   * set it to `true`); stays `false` on the abstract core class so an adapter
   * that never implemented the cursor window cannot silently degrade to
   * offset pagination.
   */
  protected supportsCursorPagination = false;

  /**
   * The field used as the cursor key. Must be unique and sortable (e.g., primary key or timestamp).
   * @default 'id'
   */
  protected cursorField?: string;

  /**
   * Cursor pagination is only advertised (query params + `next_cursor` doc
   * schema) and parsed when the endpoint enables it AND the adapter
   * implements it.
   */
  protected isCursorPaginationActive(): boolean {
    return this.cursorPaginationEnabled && this.supportsCursorPagination;
  }

  // Relations configuration
  /** Allowed relation names that can be included via ?include=relation1,relation2 */
  protected allowedIncludes: string[] = [];

  // Field selection configuration
  /** Enable field selection via ?fields=field1,field2 */
  protected fieldSelectionEnabled = false;
  /** Fields that are allowed to be selected. If empty, all schema fields are allowed. */
  protected allowedSelectFields: string[] = [];
  /** Fields that are never returned, even if requested. */
  protected blockedSelectFields: string[] = [];
  /** Fields that are always included in the response. */
  protected alwaysIncludeFields: string[] = [];
  /** Default fields to return when no fields parameter is provided. */
  protected defaultSelectFields: string[] = [];

  /**
   * Get the soft delete configuration for this model.
   */

  /**
   * Check if soft delete is enabled for this model.
   */

  // ============================================================================
  // Multi-Tenancy Support
  // ============================================================================

  /**
   * Get the multi-tenant configuration for this model.
   */

  /**
   * Check if multi-tenancy is enabled for this model.
   */

  /**
   * Get the current tenant ID from the request context.
   */

  /**
   * Validates that tenant ID is present when required.
   * Throws HTTPException if missing and required.
   */

  /**
   * Returns the query parameter schema for filtering and pagination.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> {
    // Use Record for mutable shape building (ZodRawShape is readonly in Zod v4)
    const shape: Record<string, z.ZodTypeAny> = {
      page: z.string().optional(),
      per_page: z.string().optional(),
    };

    if (this.sortFields.length > 0) {
      shape.sort = z
        .enum(this.sortFields as [string, ...string[]])
        .optional()
        .meta({ description: 'Field to sort by' });
      shape.order = z.enum(SORT_DIRECTIONS).optional().meta({
        description: 'Sort direction (asc or desc)',
      });
    }

    if (this.searchFields.length > 0) {
      shape[this.searchFieldName] = z.string().optional();
    }

    // Add filter fields
    for (const field of this.filterFields) {
      shape[field] = z.string().optional();
    }

    // Add operator-based filter fields
    if (this.filterConfig) {
      for (const [field, operators] of Object.entries(this.filterConfig)) {
        for (const op of operators) {
          shape[`${field}[${op}]`] = z.string().optional();
        }
        // Also allow simple equality
        shape[field] = z.string().optional();
      }
    }

    // Add soft delete query parameters if enabled
    const softDeleteConfig = this.getSoftDeleteConfig();
    if (softDeleteConfig.enabled && softDeleteConfig.allowQueryDeleted) {
      shape[softDeleteConfig.queryParam] = z.enum(['true', 'false']).optional();
      shape.onlyDeleted = z.enum(['true', 'false']).optional();
    }

    // Add include parameter for relations
    if (this.allowedIncludes.length > 0) {
      shape.include = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of relations to include. Allowed: ${this.allowedIncludes.join(', ')}`,
        });
    }

    // Add fields parameter for field selection
    if (this.fieldSelectionEnabled) {
      const availableFields = this.getAvailableSelectFields();
      shape.fields = z
        .string()
        .optional()
        .meta({
          description: `Comma-separated list of fields to return. Available: ${availableFields.join(', ')}`,
        });
    }

    // Add cursor-based pagination parameters (only when the adapter actually
    // implements the keyset window — never advertise a no-op).
    if (this.isCursorPaginationActive()) {
      shape.cursor = z.string().optional().meta({
        description:
          'Opaque cursor for fetching the next page. During a cursor walk, results are ordered by the cursor field ascending and sort/order are ignored.',
      });
      shape.limit = z.string().optional().meta({
        description: 'Number of items to return (cursor pagination)',
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

    // Filter to allowed fields if specified
    if (this.allowedSelectFields.length > 0) {
      available = available.filter((f) => this.allowedSelectFields.includes(f));
    }

    // Remove blocked fields
    if (this.blockedSelectFields.length > 0) {
      available = available.filter((f) => !this.blockedSelectFields.includes(f));
    }

    return available;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    // `next_cursor` is only documented when cursor pagination is genuinely
    // available (enabled AND implemented by the adapter); cursor walks are
    // next-only, so no prev_cursor exists anywhere.
    const resultInfoShape: Record<string, z.ZodTypeAny> = {
      page: z.number(),
      per_page: z.number(),
      total_count: z.number().optional(),
      total_pages: z.number().optional(),
      has_next_page: z.boolean(),
      has_prev_page: z.boolean(),
    };
    if (this.isCursorPaginationActive()) {
      resultInfoShape.next_cursor = z.string().optional();
    }

    return {
      ...this.schema,
      request: {
        query: this.getQuerySchema(),
      },
      responses: {
        200: {
          description: 'List of resources',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.array(this.getModelSchema()),
                result_info: z.object(resultInfoShape),
              }),
            },
          },
        },
        400: errorResponseSchema('Validation error'),
      },
    };
  }

  /**
   * Parses query parameters into list filters.
   */
  protected async getFilters(): Promise<ListFilters> {
    const { query } = await this.getValidatedData();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const config: ListFilterParseOptions = {
      filterFields: this.filterFields,
      filterConfig: this.filterConfig,
      searchFields: this.searchFields,
      searchFieldName: this.searchFieldName,
      sortFields: this.sortFields,
      defaultSort: this.defaultSort,
      defaultPerPage: this.defaultPerPage,
      maxPerPage: this.maxPerPage,
      cursorPaginationEnabled: this.isCursorPaginationActive(),
      cursorField: this.cursorField,
      softDeleteQueryParam: softDeleteConfig.queryParam,
      allowedIncludes: this.allowedIncludes,
      // Field selection configuration
      fieldSelectionEnabled: this.fieldSelectionEnabled,
      allowedSelectFields: this.allowedSelectFields,
      blockedSelectFields: this.blockedSelectFields,
      alwaysIncludeFields: this.alwaysIncludeFields,
      defaultSelectFields: this.defaultSelectFields,
    };

    return parseListFilters(query || {}, config);
  }

  /**
   * Lifecycle hook: called after list operation.
   * Override to transform results before returning.
   */
  async after(items: ModelObject<M['model']>[]): Promise<ModelObject<M['model']>[]> {
    return items;
  }

  /**
   * Optional transform function applied to each item before response.
   * Override to customize serialization of individual items.
   *
   * @example
   * ```ts
   * protected transform(item: User): unknown {
   *   return {
   *     ...item,
   *     fullName: `${item.firstName} ${item.lastName}`,
   *     createdAt: item.createdAt.toISOString()
   *   };
   * }
   * ```
   */
  protected transform(item: ModelObject<M['model']>): unknown {
    return item;
  }

  /**
   * Lists resources from the database with filtering, sorting, and pagination.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract list(filters: ListFilters): Promise<PaginatedResult<ModelObject<M['model']>>>;

  /**
   * Main handler for the list operation.
   */
  async handle(): Promise<Response> {
    // Loud misconfiguration: cursor pagination was enabled on an adapter
    // whose `list` does not implement the keyset window. Silently falling
    // back to offset pagination is the one unacceptable state — clients would
    // get documented-looking cursor params that are validated then ignored.
    if (this.cursorPaginationEnabled && !this.supportsCursorPagination) {
      throw new ConfigurationException(
        "cursorPaginationEnabled is true but this adapter's List endpoint does not implement cursor pagination (supportsCursorPagination is false). Use an adapter List endpoint that supports it, or disable cursorPaginationEnabled.",
      );
    }

    // Validate tenant ID if multi-tenancy is enabled
    const tenantId = this.validateTenantId();

    const filters = await this.getFilters();

    // Inject tenant filter if multi-tenancy is enabled
    if (tenantId) {
      const config = this.getMultiTenantConfig();
      filters.filters.push({
        field: config.field,
        operator: 'eq',
        value: tenantId,
      });
    }

    // Inject policy `readPushdown` filters (cheap perf opt-in: lets the
    // adapter exclude rows at the SQL level rather than post-fetch).
    this.applyReadPushdown(filters);

    const paginatedResult = await this.list(filters);

    // Decrypt encrypted fields on each record before further processing
    const decrypted = await Promise.all(
      paginatedResult.result.map((r) => this.decryptOnRead(r as Record<string, unknown>)),
    );

    // Apply policy `read` predicate post-fetch (catches whatever the
    // pushdown couldn't express) and `fields` mask. No-op when no policies.
    const policyFiltered = await this.applyReadPolicyToArray(
      decrypted as ModelObject<M['model']>[],
    );

    const items = await this.after(policyFiltered);

    // computed fields → serializer → profile → transform → field selection
    const fieldSelection =
      this.fieldSelectionEnabled && filters.options.fields && filters.options.fields.length > 0
        ? { fields: filters.options.fields, isActive: true }
        : undefined;
    const result = await this.finalizeArray(items, fieldSelection);

    return this.successPaginated(result, paginatedResult.result_info);
  }
}
