import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { CrudEndpoint } from './base';
import { getLogger } from '../core/logger';
import type {MetaInput, OpenAPIRouteSchema, HookMode, HookContext, RelationConfig} from '../core/types';
import { applyComputedFields, extractNestedData } from '../core/types';
import { getSchemaFields, type ModelObject } from './types';

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
> extends CrudEndpoint<E, M> {

  // Hook execution mode
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

  // Nested writes configuration
  /** Relations that allow nested creates. If empty, uses relation config. */
  protected allowNestedCreate: string[] = [];

  // Audit logging

  /**
   * Get the audit logger for this endpoint.
   */

  /**
   * Get the audit configuration for this model.
   */

  /**
   * Check if audit logging is enabled for this model.
   */

  /**
   * Get the user ID for audit logging.
   * Override this method to customize how user ID is extracted.
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
   * Returns undefined if multi-tenancy is not enabled or tenant ID is not found.
   */

  /**
   * Validates that tenant ID is present when required.
   * Throws HTTPException if missing and required.
   */

  /**
   * Injects tenant ID into the data object.
   * Called automatically before create when multi-tenancy is enabled.
   */

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
      baseSchema = getSchemaFields(this.getModelSchema(), excludeFields);
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
                result: this.getModelSchema(),
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
   *
   * The optional `hookCtx` carries the in-flight transaction handle
   * (`hookCtx.db.tx`) plus tenant/org/user/agent identifiers. Existing
   * overrides typed as `(data, tx?: unknown)` continue to compile because
   * the second param is widened to `HookContext` — `tx` becomes the
   * `HookContext` value but is typed loosely enough to be ignored.
   */
  async before(
    data: ModelObject<M['model']>,
    _hookCtx: HookContext
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Lifecycle hook: called after create operation. When `afterHookMode ===
   * 'sequential'` AND the adapter wraps in a transaction, throwing here
   * rolls back the parent INSERT. The default `fire-and-forget` mode runs
   * after the response is sent and cannot trigger rollback.
   */
  async after(
    data: ModelObject<M['model']>,
    _hookCtx: HookContext
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
    _parentId: string | number,
    relationName: string,
    _relationConfig: RelationConfig,
    _data: unknown,
    _tx?: unknown
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

    const hookCtx = this.buildHookContext();
    obj = await this.before(obj, hookCtx);
    obj = await this.encryptOnWrite(obj as Record<string, unknown>) as ModelObject<M['model']>;
    obj = await this.create(obj, hookCtx.db.tx);
    obj = await this.decryptOnRead(obj as Record<string, unknown>) as ModelObject<M['model']>;

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

    // Handle after hook based on mode.
    // Fire-and-forget cannot trigger rollback because the response has
    // already been queued. Sequential mode runs inside the parent tx
    // (when the adapter wraps in one) — throwing rolls back the INSERT.
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(obj, hookCtx)));
    } else {
      obj = await this.after(obj, hookCtx);
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

    // Emit created event
    if (parentId !== null) {
      this.runAfterResponse(this.emitEvent('created', { recordId: parentId, data: obj }));
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

    // Apply default serialization profile (model.serializationProfile)
    const profiled = this.applyProfile(serialized as Record<string, unknown>);

    // Apply transform
    const result = this.transform(profiled as ModelObject<M['model']>);

    return this.success(result, 201);
  }

  /**
   * Gets the parent ID from the created record.
   * Override if your primary key is not 'id'.
   */
}
