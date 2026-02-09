import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, NormalizedSoftDeleteConfig, NormalizedMultiTenantConfig, IncludeOptions } from '../core/types';
import { getSoftDeleteConfig, applyComputedFields, getMultiTenantConfig, extractTenantId } from '../core/types';
import { NotFoundException } from '../core/exceptions';
import { applyFieldSelection, type SingleEndpointConfig, type ModelObject, type FieldSelection } from './types';
import { generateETag, matchesIfNoneMatch } from '../core/etag';

/**
 * Base endpoint for reading a single resource.
 * Extend this class and implement the `read` method for your ORM.
 *
 * Supports soft delete filtering when the model has `softDelete` configured.
 * When soft delete is enabled, the `read` method should filter out
 * soft-deleted records by default.
 */
export abstract class ReadEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Lookup configuration
  protected lookupField: string = 'id';
  protected lookupFields?: string[];
  protected additionalFilters?: string[];

  // ETag configuration
  /** Enable ETag generation and If-None-Match support for conditional requests */
  protected etagEnabled: boolean = false;

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
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Returns the query parameter schema for includes and additional filters.
   */
  protected getQuerySchema(): ZodObject<ZodRawShape> | undefined {
    // Use Record for mutable shape building (ZodRawShape is readonly in Zod v4)
    const shape: Record<string, z.ZodTypeAny> = {};

    // Add additional filter fields
    if (this.additionalFilters?.length) {
      for (const field of this.additionalFilters) {
        shape[field] = z.string().optional();
      }
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

    if (Object.keys(shape).length === 0) {
      return undefined;
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
    const querySchema = this.getQuerySchema();
    return {
      ...this.schema,
      request: {
        params: this.getParamsSchema(),
        ...(querySchema && { query: querySchema }),
      },
      responses: {
        200: {
          description: 'Resource retrieved successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: this._meta.model.schema,
              }),
            },
          },
        },
        404: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the lookup value from path parameters.
   */
  protected async getLookupValue(): Promise<string> {
    const { params } = await this.getValidatedData();
    return params?.[this.lookupField] || '';
  }

  /**
   * Gets additional filter values from query parameters.
   */
  protected async getAdditionalFilters(): Promise<Record<string, string>> {
    if (!this.additionalFilters?.length) {
      return {};
    }

    const { query } = await this.getValidatedData();
    const filters: Record<string, string> = {};

    for (const field of this.additionalFilters) {
      if (query?.[field]) {
        filters[field] = String(query[field]);
      }
    }

    return filters;
  }

  /**
   * Gets the include options from query parameters.
   */
  protected async getIncludeOptions(): Promise<IncludeOptions> {
    const { query } = await this.getValidatedData();
    const includeParam = query?.include;

    if (!includeParam || typeof includeParam !== 'string') {
      return { relations: [] };
    }

    const requested = includeParam.split(',').map((v) => v.trim()).filter(Boolean);

    // Filter to only allowed includes
    if (this.allowedIncludes.length > 0) {
      return {
        relations: requested.filter((r) => this.allowedIncludes.includes(r)),
      };
    }

    return { relations: requested };
  }

  /**
   * Gets the field selection options from query parameters.
   */
  protected async getFieldSelection(): Promise<FieldSelection> {
    if (!this.fieldSelectionEnabled) {
      return { fields: [], isActive: false };
    }

    const { query } = await this.getValidatedData();
    const fieldsParam = query?.fields;

    if (!fieldsParam || typeof fieldsParam !== 'string' || fieldsParam.trim() === '') {
      // Return default fields if specified
      if (this.defaultSelectFields.length > 0) {
        const fields = [...new Set([...this.alwaysIncludeFields, ...this.defaultSelectFields])];
        return { fields, isActive: true };
      }
      return { fields: [], isActive: false };
    }

    const requested = fieldsParam.split(',').map((f) => f.trim()).filter(Boolean);
    const available = new Set(this.getAvailableSelectFields());

    // Filter to available fields
    let selected = requested.filter((f) => available.has(f));

    // Always include required fields
    if (this.alwaysIncludeFields.length > 0) {
      selected = [...new Set([...this.alwaysIncludeFields, ...selected])];
    }

    return { fields: selected, isActive: true };
  }

  /**
   * Lifecycle hook: called after read operation.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Optional transform function applied to the item before response.
   * Override to customize serialization.
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
   * Reads the resource from the database.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param lookupValue - The value to look up (e.g., ID)
   * @param additionalFilters - Additional filter conditions
   * @param includeOptions - Relations to include in the result
   */
  abstract read(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    includeOptions?: IncludeOptions
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Main handler for the read operation.
   */
  async handle(): Promise<Response> {

    // Validate tenant ID if multi-tenancy is enabled
    const tenantId = this.validateTenantId();

    const lookupValue = await this.getLookupValue();
    const additionalFilters = await this.getAdditionalFilters();
    const includeOptions = await this.getIncludeOptions();
    const fieldSelection = await this.getFieldSelection();

    // Inject tenant filter if multi-tenancy is enabled
    if (tenantId) {
      const config = this.getMultiTenantConfig();
      additionalFilters[config.field] = tenantId;
    }

    let obj = await this.read(lookupValue, additionalFilters, includeOptions);

    if (!obj) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    obj = await this.after(obj);

    // Apply computed fields if defined
    if (this._meta.model.computedFields) {
      obj = await applyComputedFields(
        obj as Record<string, unknown>,
        this._meta.model.computedFields
      ) as ModelObject<M['model']>;
    }

    // Apply serializer if defined
    const serialized = this._meta.model.serializer
      ? this._meta.model.serializer(obj)
      : obj;

    // Apply transform
    const transformed = this.transform(serialized as ModelObject<M['model']>);

    // Apply field selection if enabled and fields were specified
    const result = (fieldSelection.isActive && fieldSelection.fields.length > 0)
      ? applyFieldSelection(transformed as Record<string, unknown>, fieldSelection)
      : transformed;

    // ETag support
    if (this.etagEnabled) {
      const etag = await generateETag(result);
      const ctx = this.getContext();

      // Check If-None-Match for conditional GET
      const ifNoneMatch = ctx.req.header('If-None-Match');
      if (matchesIfNoneMatch(ifNoneMatch, etag)) {
        return new Response(null, {
          status: 304,
          headers: { 'ETag': etag },
        });
      }

      ctx.header('ETag', etag);
    }

    return this.success(result);
  }
}
