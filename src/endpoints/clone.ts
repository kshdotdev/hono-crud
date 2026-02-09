import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { OpenAPIRoute } from '../core/route';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  NormalizedSoftDeleteConfig,
  NormalizedMultiTenantConfig,
} from '../core/types';
import { getSoftDeleteConfig, applyComputedFields, getMultiTenantConfig, extractTenantId } from '../core/types';
import { NotFoundException } from '../core/exceptions';
import { getSchemaFields, type ModelObject } from './types';

/**
 * Base endpoint for cloning/duplicating a resource.
 * Fetches an existing record by ID, strips primary keys,
 * applies optional overrides from the request body, and creates a new record.
 *
 * Route pattern: `POST /resource/:id/clone`
 *
 * @example
 * ```ts
 * class UserClone extends MemoryCloneEndpoint {
 *   _meta = { model: UserModel };
 *
 *   // Optionally exclude fields from cloning
 *   excludeFromClone = ['email', 'createdAt'];
 * }
 *
 * // Register: POST /users/:id/clone
 * ```
 */
export abstract class CloneEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Lookup configuration
  protected lookupField: string = 'id';

  /** Fields to exclude from the cloned record (besides primary keys). */
  protected excludeFromClone: string[] = [];

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

  protected getMultiTenantConfig(): NormalizedMultiTenantConfig {
    return getMultiTenantConfig(this._meta.model.multiTenant);
  }

  protected isMultiTenantEnabled(): boolean {
    return this.getMultiTenantConfig().enabled;
  }

  protected getTenantId(): string | undefined {
    if (!this.context) return undefined;
    const config = this.getMultiTenantConfig();
    return extractTenantId(this.context, config);
  }

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
   * Returns the body schema for overrides (all fields optional).
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    const excludeFields = [
      ...this._meta.model.primaryKeys,
      ...this.excludeFromClone,
    ];
    const schema = getSchemaFields(this._meta.model.schema, excludeFields);
    return schema.partial() as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema.
   */
  getSchema(): OpenAPIRouteSchema {
    return {
      ...this.schema,
      request: {
        params: this.getParamsSchema(),
        body: {
          content: {
            'application/json': {
              schema: this.getBodySchema(),
            },
          },
          required: false,
        },
      },
      responses: {
        201: {
          description: 'Resource cloned successfully',
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
          description: 'Source resource not found',
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
   * Gets the optional override data from request body.
   */
  protected async getOverrides(): Promise<Partial<ModelObject<M['model']>>> {
    const { body } = await this.getValidatedData<Partial<ModelObject<M['model']>>>();
    return (body || {}) as Partial<ModelObject<M['model']>>;
  }

  /**
   * Lifecycle hook: called before creating the clone.
   * Override to transform cloned data before saving.
   */
  async before(
    data: ModelObject<M['model']>
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Lifecycle hook: called after creating the clone.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Reads the source record.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract findSource(
    lookupValue: string,
    additionalFilters?: Record<string, string>
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Creates the cloned record.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract createClone(
    data: ModelObject<M['model']>
  ): Promise<ModelObject<M['model']>>;

  /**
   * Main handler for the clone operation.
   */
  async handle(): Promise<Response> {
    const tenantId = this.validateTenantId();

    const lookupValue = await this.getLookupValue();
    const overrides = await this.getOverrides();

    // Build additional filters for tenant
    const additionalFilters: Record<string, string> = {};
    if (tenantId) {
      const config = this.getMultiTenantConfig();
      additionalFilters[config.field] = tenantId;
    }

    // Fetch the source record
    const source = await this.findSource(lookupValue, additionalFilters);
    if (!source) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Build clone data: source minus PKs and excluded fields, plus overrides
    const cloneData = { ...source } as Record<string, unknown>;

    // Remove primary keys
    for (const pk of this._meta.model.primaryKeys) {
      delete cloneData[pk];
    }

    // Remove excluded fields
    for (const field of this.excludeFromClone) {
      delete cloneData[field];
    }

    // Apply overrides
    Object.assign(cloneData, overrides);

    // Run before hook
    let data = await this.before(cloneData as ModelObject<M['model']>);

    // Create the clone
    let obj = await this.createClone(data);

    // Run after hook
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

    return this.success(serialized, 201);
  }
}
