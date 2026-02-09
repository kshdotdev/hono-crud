import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { OpenAPIRoute } from '../core/route';
import { getLogger } from '../core/logger';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  HookMode,
  RelationConfig,
  NestedWriteResult,
  NormalizedAuditConfig,
  NormalizedMultiTenantConfig,
} from '../core/types';
import { applyComputedFields, extractNestedData, isDirectNestedData, getAuditConfig, getMultiTenantConfig, extractTenantId } from '../core/types';
import { getSchemaFields, type ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Base endpoint for creating resources.
 * Extend this class and implement the `create` method for your ORM.
 *
 * Supports nested writes when relations are configured with `nestedWrites.allowCreate: true`.
 * Nested data can be provided directly in the request body:
 *
 * @example
 * ```json
 * POST /users
 * {
 *   "name": "John",
 *   "email": "john@example.com",
 *   "profile": {
 *     "bio": "Developer",
 *     "avatar": "https://..."
 *   },
 *   "posts": [
 *     { "title": "Hello World", "content": "..." }
 *   ]
 * }
 * ```
 */
export abstract class CreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Hook execution mode
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

  // Nested writes configuration
  /** Relations that allow nested creates. If empty, uses relation config. */
  protected allowNestedCreate: string[] = [];

  // Audit logging
  private _auditLogger?: AuditLogger;

  /**
   * Get the audit logger for this endpoint.
   */
  protected getAuditLogger(): AuditLogger {
    if (!this._auditLogger) {
      this._auditLogger = createAuditLogger(this._meta.model.audit);
    }
    return this._auditLogger;
  }

  /**
   * Get the audit configuration for this model.
   */
  protected getAuditConfig(): NormalizedAuditConfig {
    return getAuditConfig(this._meta.model.audit);
  }

  /**
   * Check if audit logging is enabled for this model.
   */
  protected isAuditEnabled(): boolean {
    return this.getAuditConfig().enabled;
  }

  /**
   * Get the user ID for audit logging.
   * Override this method to customize how user ID is extracted.
   */
  protected getAuditUserId(): string | undefined {
    const config = this.getAuditConfig();
    if (config.getUserId && this.context) {
      return config.getUserId(this.context);
    }
    // Default: try to get from context
    // Try to get userId from context variables
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
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
   * Returns undefined if multi-tenancy is not enabled or tenant ID is not found.
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
   * Injects tenant ID into the data object.
   * Called automatically before create when multi-tenancy is enabled.
   */
  protected injectTenantId<T extends Record<string, unknown>>(data: T): T {
    const config = this.getMultiTenantConfig();
    if (!config.enabled) return data;

    const tenantId = this.getTenantId();
    if (!tenantId) return data;

    return {
      ...data,
      [config.field]: tenantId,
    };
  }

  /**
   * Returns the Zod schema for request body.
   * By default, uses the model schema minus primary keys.
   * Also excludes multi-tenant field since it's injected automatically.
   * Includes nested relation schemas if nested writes are enabled.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    let baseSchema: ZodObject<ZodRawShape>;

    // Build list of fields to exclude from input
    const excludeFields = [...this._meta.model.primaryKeys];

    // Exclude multi-tenant field if enabled (it's injected automatically)
    const mtConfig = this.getMultiTenantConfig();
    if (mtConfig.enabled) {
      excludeFields.push(mtConfig.field);
    }

    if (this._meta.fields) {
      baseSchema = this._meta.fields;
    } else {
      baseSchema = getSchemaFields(this._meta.model.schema, excludeFields);
    }

    // Add nested relation schemas
    const nestedRelations = this.getNestedWritableRelations();
    if (nestedRelations.length === 0) {
      return baseSchema;
    }

    const shape = { ...baseSchema.shape };

    for (const relationName of nestedRelations) {
      const relationConfig = this._meta.model.relations?.[relationName];
      if (!relationConfig?.schema) continue;

      // Get the related schema without primary keys and foreign key
      // We exclude the foreign key because it's set automatically to the parent ID
      const excludeFields = ['id', relationConfig.foreignKey];
      const relatedSchema = getSchemaFields(
        relationConfig.schema,
        excludeFields
      );

      if (relationConfig.type === 'hasMany') {
        // Array of related records
        shape[relationName] = z.array(relatedSchema).optional();
      } else {
        // Single related record
        shape[relationName] = relatedSchema.optional();
      }
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the list of relations that allow nested creates.
   */
  protected getNestedWritableRelations(): string[] {
    // If explicitly configured, use that
    if (this.allowNestedCreate.length > 0) {
      return this.allowNestedCreate;
    }

    // Otherwise, check relation configs
    const relations = this._meta.model.relations;
    if (!relations) return [];

    return Object.entries(relations)
      .filter(([_, config]) => config.nestedWrites?.allowCreate === true)
      .map(([name]) => name);
  }

  /**
   * Extracts nested relation data from the request body.
   */
  protected extractNestedData(
    data: Record<string, unknown>
  ): {
    mainData: Record<string, unknown>;
    nestedData: Record<string, unknown>;
  } {
    const relationNames = this.getNestedWritableRelations();
    return extractNestedData(data, relationNames);
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const bodySchema = this.getBodySchema();

    return {
      ...this.schema,
      request: {
        body: {
          content: {
            'application/json': {
              schema: bodySchema,
            },
          },
          required: true,
        },
      },
      responses: {
        201: {
          description: 'Resource created successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: this._meta.model.schema,
              }),
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                  details: z.unknown().optional(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the validated request body.
   */
  protected async getObject(): Promise<ModelObject<M['model']>> {
    const { body } = await this.getValidatedData<ModelObject<M['model']>>();
    return body as ModelObject<M['model']>;
  }

  /**
   * Lifecycle hook: called before create operation.
   * Override to transform data before saving.
   */
  async before(
    data: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Lifecycle hook: called after create operation.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Optional transform function applied to the created item before response.
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
   * Creates the resource in the database.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract create(
    data: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>>;

  /**
   * Creates nested related records.
   * Override in ORM-specific subclasses to implement nested writes.
   *
   * @param parentId - The ID of the parent record
   * @param relationName - The name of the relation
   * @param relationConfig - The relation configuration
   * @param data - The nested data to create (single object or array)
   * @param tx - Optional transaction context
   * @returns The created nested records
   */
  protected async createNested(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    data: unknown,
    tx?: unknown
  ): Promise<unknown[]> {
    // Default implementation does nothing - override in adapter
    getLogger().warn(`Nested writes not implemented for ${relationName}. Override createNested() in your adapter.`);
    return [];
  }

  /**
   * Main handler for the create operation.
   */
  async handle(): Promise<Response> {
    // Validate tenant ID if multi-tenancy is enabled
    this.validateTenantId();

    const rawData = await this.getObject();

    // Extract nested data from request
    const { mainData, nestedData } = this.extractNestedData(
      rawData as Record<string, unknown>
    );

    // Process main record
    let obj = mainData as ModelObject<M['model']>;

    // Inject tenant ID if multi-tenancy is enabled
    obj = this.injectTenantId(obj as Record<string, unknown>) as ModelObject<M['model']>;

    obj = await this.before(obj);
    obj = await this.create(obj);

    // Get the parent ID for nested writes
    const parentId = this.getParentId(obj);

    // Process nested creates
    const nestedResults: Record<string, unknown[]> = {};
    if (Object.keys(nestedData).length > 0 && parentId !== null) {
      for (const [relationName, data] of Object.entries(nestedData)) {
        if (data === undefined || data === null) continue;

        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        const createdNested = await this.createNested(
          parentId,
          relationName,
          relationConfig,
          data
        );

        nestedResults[relationName] = createdNested;
      }
    }

    // Attach nested results to the response
    if (Object.keys(nestedResults).length > 0) {
      const formattedResults: Record<string, unknown> = {};
      for (const [relationName, results] of Object.entries(nestedResults)) {
        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        // For hasOne/belongsTo, return single object; for hasMany, return array
        if (relationConfig.type === 'hasMany') {
          formattedResults[relationName] = results;
        } else {
          formattedResults[relationName] = results[0] || null;
        }
      }
      obj = { ...obj, ...formattedResults } as ModelObject<M['model']>;
    }

    // Handle after hook based on mode
    if (this.afterHookMode === 'fire-and-forget') {
      // Fire and forget - don't await
      this.runAfterResponse(Promise.resolve(this.after(obj)));
    } else {
      obj = await this.after(obj);
    }

    // Audit logging
    if (this.isAuditEnabled() && parentId !== null) {
      const auditLogger = this.getAuditLogger();
      this.runAfterResponse(auditLogger.logCreate(
        this._meta.model.tableName,
        parentId,
        obj as Record<string, unknown>,
        this.getAuditUserId()
      ));
    }

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
    const result = this.transform(serialized as ModelObject<M['model']>);

    return this.success(result, 201);
  }

  /**
   * Gets the parent ID from the created record.
   * Override if your primary key is not 'id'.
   */
  protected getParentId(record: ModelObject<M['model']>): string | number | null {
    const pk = this._meta.model.primaryKeys[0];
    const id = (record as Record<string, unknown>)[pk];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return null;
  }
}
