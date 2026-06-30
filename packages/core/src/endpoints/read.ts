import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { type CacheableEndpoint, readEndpointCache, writeEndpointCache } from '../core/cache';
import { NotFoundException } from '../core/exceptions';
import type { IncludeOptions, MetaInput, OpenAPIRouteSchema } from '../core/types';
import { withIncludableRelations } from '../relations/response-schema';
import { generateETag, matchesIfNoneMatch } from '../utils/etag';
import { CrudEndpoint } from './base';
import { errorResponseSchema, mergeRouteSchema } from './responses';
import type { FieldSelection, ModelObject } from './types';

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
> extends CrudEndpoint<E, M> {
  // Lookup configuration
  protected lookupField = 'id';
  protected lookupFields?: string[];
  protected additionalFilters?: string[];

  // ETag configuration
  /** Enable ETag generation and If-None-Match support for conditional requests */
  protected etagEnabled = false;

  // Response cache fields (cacheEnabled/cacheTtlSeconds/…) live on CrudEndpoint.

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
   */

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

    if (Object.keys(shape).length === 0) {
      return undefined;
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
    const querySchema = this.getQuerySchema();
    return mergeRouteSchema(
      {
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
                  result: withIncludableRelations(
                    this.getModelSchema(),
                    this._meta,
                    this.allowedIncludes,
                  ),
                }),
              },
            },
          },
          404: errorResponseSchema('Resource not found'),
        },
      },
      this.schema,
    );
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

    const requested = includeParam
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

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

    const requested = fieldsParam
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
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
  async after(data: ModelObject<M['model']>): Promise<ModelObject<M['model']>> {
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
    includeOptions?: IncludeOptions,
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Main handler for the read operation.
   */
  async handle(): Promise<Response> {
    // Validate tenant ID if multi-tenancy is enabled
    const tenantId = this.validateTenantId();

    // Response cache check (config-driven). Tenant-scoped key, so a cached
    // record is only ever served back to the tenant that produced it;
    // `isResponseCacheActive` disables caching under user-scoped read policies
    // (unless cachePerUser) so one user's view can't leak to another.
    const cacheActive = this.isResponseCacheActive();
    if (cacheActive) {
      const cached = await readEndpointCache<ModelObject<M['model']>>(
        this as unknown as CacheableEndpoint,
        tenantId,
      );
      if (cached) {
        // Honor conditional GET on a cache HIT too (parity with the MISS path).
        if (this.etagEnabled) {
          const etag = await generateETag(cached);
          const ctx = this.getContext();
          if (matchesIfNoneMatch(ctx.req.header('If-None-Match'), etag)) {
            return new Response(null, { status: 304, headers: { ETag: etag, 'X-Cache': 'HIT' } });
          }
          ctx.header('ETag', etag);
        }
        const hit = this.success(cached);
        hit.headers.set('X-Cache', 'HIT');
        return hit;
      }
    }

    const lookupValue = await this.getLookupValue();
    const additionalFilters = await this.getAdditionalFilters();
    const includeOptions = await this.getIncludeOptions();
    // Scope included related rows to the caller (owner-scope + soft-delete), so
    // `?include=` can't expose a related row in another tenant. Read never
    // surfaces soft-deleted rows, so includeDeleted stays false.
    if (includeOptions) includeOptions.scope = this.getRelationScope();
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

    obj = (await this.decryptOnRead(obj as Record<string, unknown>)) as ModelObject<M['model']>;

    // Apply policy `read` predicate. Treat denial as 404 to avoid leaking
    // resource existence to callers that aren't allowed to see it.
    const allowed = await this.applyReadPolicy(obj as ModelObject<M['model']>);
    if (allowed === null) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }
    obj = allowed;

    obj = await this.after(obj);

    // computed fields → serializer → profile → transform → field selection
    const result = await this.finalizeRecord(obj, fieldSelection);

    // Populate the response cache (config-driven) before the ETag branch so the
    // record is cached even when this request 304s on a conditional GET.
    if (cacheActive) {
      await writeEndpointCache(this as unknown as CacheableEndpoint, result, tenantId);
    }

    // ETag support
    if (this.etagEnabled) {
      const etag = await generateETag(result);
      const ctx = this.getContext();

      // Check If-None-Match for conditional GET
      const ifNoneMatch = ctx.req.header('If-None-Match');
      if (matchesIfNoneMatch(ifNoneMatch, etag)) {
        return new Response(null, {
          status: 304,
          headers: cacheActive ? { ETag: etag, 'X-Cache': 'MISS' } : { ETag: etag },
        });
      }

      ctx.header('ETag', etag);
    }

    const response = this.success(result);
    if (cacheActive) response.headers.set('X-Cache', 'MISS');
    return response;
  }
}
