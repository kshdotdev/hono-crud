import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, PaginatedResult, NormalizedSoftDeleteConfig, NormalizedMultiTenantConfig } from '../core/types';
import { getSoftDeleteConfig, applyComputedFieldsToArray, getMultiTenantConfig, extractTenantId } from '../core/types';
import {
  parseListFilters,
  applyFieldSelectionToArray,
  type ListEndpointConfig,
  type ListFilters,
  type ModelObject,
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
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Filter configuration
  protected filterFields: string[] = [];
  protected filterConfig?: Record<string, Array<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'null' | 'between'>>;

  // Search configuration
  protected searchFields: string[] = [];
  protected searchFieldName: string = 'search';

  // Sorting configuration
  /** Fields that can be used for sorting. Use with ?sort=fieldName */
  protected sortFields: string[] = [];
  /** Default sort configuration */
  protected defaultSort?: { field: string; order: 'asc' | 'desc' };

  // Pagination configuration
  protected defaultPerPage: number = 20;
  protected maxPerPage: number = 100;

  // Relations configuration
  /** Allowed relation names that can be included via ?include=relation1,relation2 */
  protected allowedIncludes: string[] = [];

  // Field selection configuration
  /** Enable field selection via ?fields=field1,field2 */
  protected fieldSelectionEnabled: boolean = false;
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
  protected getSoftDeleteConfig(): NormalizedSoftDeleteConfig {
    return getSoftDeleteConfig(this._meta.model.softDelete);
  }

  /**
   * Check if soft delete is enabled for this model.
   */
  protected isSoftDeleteEnabled(): boolean {
    return this.getSoftDeleteConfig().enabled;
  }

  // ============================================================================
  // Multi-Tenancy Support
  // ============================================================================

  /**
   * Get the multi-tenant configuration for this model.
   */
  protected getMultiTenantConfig(): NormalizedMultiTenantConfig {
    return getMultiTenantConfig(this._meta.model.multiTenant);
  }

  /**
   * Check if multi-tenancy is enabled for this model.
   */
  protected isMultiTenantEnabled(): boolean {
    return this.getMultiTenantConfig().enabled;
  }

  /**
   * Get the current tenant ID from the request context.
   */
  protected getTenantId(): string | undefined {
    if (!this.context) return undefined;
    const config = this.getMultiTenantConfig();
    return extractTenantId(this.context, config);
  }

  /**
   * Validates that tenant ID is present when required.
   * Throws HTTPException if missing and required.
   */
  protected validateTenantId(): string | undefined {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return undefined;

    const tenantId = this.getTenantId();

    if (!tenantId && config.required) {
      throw new HTTPException(400, { message: config.errorMessage });
    }

    return tenantId;
  }

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
      shape.sort = z.enum(this.sortFields as [string, ...string[]]).optional().describe('Field to sort by');
      shape.order = z.enum(['asc', 'desc']).optional().describe('Sort direction (asc or desc)');
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
      shape.include = z.string().optional().describe(
        `Comma-separated list of relations to include. Allowed: ${this.allowedIncludes.join(', ')}`
      );
    }

    // Add fields parameter for field selection
    if (this.fieldSelectionEnabled) {
      const availableFields = this.getAvailableSelectFields();
      shape.fields = z.string().optional().describe(
        `Comma-separated list of fields to return. Available: ${availableFields.join(', ')}`
      );
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the list of fields available for selection.
   */
  protected getAvailableSelectFields(): string[] {
    const schemaFields = Object.keys(this._meta.model.schema.shape);
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
                result: z.array(this._meta.model.schema),
                result_info: z.object({
                  page: z.number(),
                  per_page: z.number(),
                  total_count: z.number().optional(),
                  total_pages: z.number().optional(),
                  has_next_page: z.boolean(),
                  has_prev_page: z.boolean(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Parses query parameters into list filters.
   */
  protected async getFilters(): Promise<ListFilters> {
    const { query } = await this.getValidatedData();
    const softDeleteConfig = this.getSoftDeleteConfig();

    const config: ListEndpointConfig = {
      filterFields: this.filterFields,
      filterConfig: this.filterConfig,
      searchFields: this.searchFields,
      searchFieldName: this.searchFieldName,
      sortFields: this.sortFields,
      defaultSort: this.defaultSort,
      defaultPerPage: this.defaultPerPage,
      maxPerPage: this.maxPerPage,
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
  async after(
    items: ModelObject<M['model']>[]
  ): Promise<ModelObject<M['model']>[]> {
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

    const paginatedResult = await this.list(filters);

    let items = await this.after(paginatedResult.result);

    // Apply computed fields if defined
    if (this._meta.model.computedFields) {
      items = await applyComputedFieldsToArray(
        items as Record<string, unknown>[],
        this._meta.model.computedFields
      ) as ModelObject<M['model']>[];
    }

    // Apply serializer if defined
    if (this._meta.model.serializer) {
      items = items.map((item) => this._meta.model.serializer!(item) as ModelObject<M['model']>);
    }

    // Apply transform to each item
    const transformedItems = items.map((item) => this.transform(item));

    // Apply field selection if enabled and fields were specified
    const result = (this.fieldSelectionEnabled && filters.options.fields && filters.options.fields.length > 0)
      ? applyFieldSelectionToArray(
          transformedItems as Record<string, unknown>[],
          { fields: filters.options.fields, isActive: true }
        )
      : transformedItems;

    return this.json({
      success: true,
      result,
      result_info: paginatedResult.result_info,
    });
  }
}
