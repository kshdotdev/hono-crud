import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { OpenAPIRoute } from '../core/route';
import { getLogger } from '../core/logger';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  HookMode,
  NormalizedSoftDeleteConfig,
  NormalizedAuditConfig,
  NormalizedVersioningConfig,
  NormalizedMultiTenantConfig,
  RelationConfig,
  NestedUpdateInput,
  NestedWriteResult,
} from '../core/types';
import { getSoftDeleteConfig, applyComputedFields, extractNestedData, isDirectNestedData, getAuditConfig, getVersioningConfig, getMultiTenantConfig, extractTenantId } from '../core/types';
import { NotFoundException } from '../core/exceptions';
import { generateETag, matchesIfMatch } from '../core/etag';
import { getSchemaFields, type ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';
import { createVersionManager, type VersionManager } from '../core/versioning';

/**
 * Base endpoint for updating resources.
 * Extend this class and implement the `update` method for your ORM.
 *
 * Supports soft delete filtering when the model has `softDelete` configured.
 * When soft delete is enabled, the `update` method should filter out
 * soft-deleted records by default (cannot update deleted records).
 *
 * Supports nested writes when relations are configured with nested write permissions.
 * Nested data can be provided using operation objects:
 *
 * @example
 * ```json
 * PATCH /users/:id
 * {
 *   "name": "John Updated",
 *   "profile": {
 *     "update": { "bio": "Senior Developer" }
 *   },
 *   "posts": {
 *     "create": [{ "title": "New Post" }],
 *     "update": [{ "id": "123", "title": "Updated" }],
 *     "delete": ["456"]
 *   }
 * }
 * ```
 */
export abstract class UpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Lookup configuration
  protected lookupField: string = 'id';
  protected lookupFields?: string[];
  protected additionalFilters?: string[];

  // Update field control
  protected allowedUpdateFields?: string[];
  protected blockedUpdateFields?: string[];

  // Hook execution mode
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

  // Nested writes configuration
  /** Relations that allow nested writes. If empty, uses relation config. */
  protected allowNestedWrites: string[] = [];

  // ETag configuration
  /** Enable If-Match support for optimistic concurrency control */
  protected etagEnabled: boolean = false;

  // Audit logging
  private _auditLogger?: AuditLogger;

  // Versioning
  private _versionManager?: VersionManager;

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
   */
  protected getAuditUserId(): string | undefined {
    const config = this.getAuditConfig();
    if (config.getUserId && this.context) {
      return config.getUserId(this.context);
    }
    // Try to get userId from context variables
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
  }

  /**
   * Get the version manager for this endpoint.
   */
  protected getVersionManager(): VersionManager {
    if (!this._versionManager) {
      this._versionManager = createVersionManager(
        this._meta.model.versioning,
        this._meta.model.tableName
      );
    }
    return this._versionManager;
  }

  /**
   * Get the versioning configuration for this model.
   */
  protected getVersioningConfig(): NormalizedVersioningConfig {
    return getVersioningConfig(this._meta.model.versioning, this._meta.model.tableName);
  }

  /**
   * Check if versioning is enabled for this model.
   */
  protected isVersioningEnabled(): boolean {
    return this.getVersioningConfig().enabled;
  }

  /**
   * Get the user ID for versioning.
   */
  protected getVersioningUserId(): string | undefined {
    const config = this.getVersioningConfig();
    if (config.getUserId && this.context) {
      return config.getUserId(this.context);
    }
    // Try to get userId from context variables
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
  }

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
   * Returns the Zod schema for request body.
   * By default, uses the model schema minus primary keys, all fields optional.
   * Includes nested relation schemas if nested writes are enabled.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    let baseSchema: ZodObject<ZodRawShape>;

    if (this._meta.fields) {
      baseSchema = this._meta.fields.partial() as ZodObject<ZodRawShape>;
    } else {
      let excludeFields = [...this._meta.model.primaryKeys];
      if (this.blockedUpdateFields) {
        excludeFields = [...excludeFields, ...this.blockedUpdateFields];
      }

      let schema = getSchemaFields(this._meta.model.schema, excludeFields);

      if (this.allowedUpdateFields) {
        // Only include allowed fields
        const pickObj = this.allowedUpdateFields.reduce(
          (acc, key) => ({ ...acc, [key]: true }),
          {}
        );
        schema = schema.pick(pickObj) as unknown as ZodObject<ZodRawShape>;
      }

      baseSchema = schema.partial() as ZodObject<ZodRawShape>;
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

      // Get the related schema
      const relatedSchema = relationConfig.schema;

      // Create a nested update input schema
      const nestedUpdateSchema = z.object({
        create: z.union([relatedSchema.partial(), z.array(relatedSchema.partial())]).optional(),
        update: z.array(relatedSchema.partial().extend({ id: z.union([z.string(), z.number()]) })).optional(),
        delete: z.array(z.union([z.string(), z.number()])).optional(),
        connect: z.array(z.union([z.string(), z.number()])).optional(),
        disconnect: z.array(z.union([z.string(), z.number()])).optional(),
        set: relatedSchema.partial().nullable().optional(),
      }).optional();

      shape[relationName] = nestedUpdateSchema;
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the list of relations that allow nested writes.
   */
  protected getNestedWritableRelations(): string[] {
    // If explicitly configured, use that
    if (this.allowNestedWrites.length > 0) {
      return this.allowNestedWrites;
    }

    // Otherwise, check relation configs
    const relations = this._meta.model.relations;
    if (!relations) return [];

    return Object.entries(relations)
      .filter(([_, config]) => {
        const nw = config.nestedWrites;
        return nw && (nw.allowCreate || nw.allowUpdate || nw.allowDelete || nw.allowConnect || nw.allowDisconnect);
      })
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
          required: true,
        },
      },
      responses: {
        200: {
          description: 'Resource updated successfully',
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
   * Gets the validated request body.
   */
  protected async getObject(): Promise<Partial<ModelObject<M['model']>>> {
    const { body } = await this.getValidatedData<Partial<ModelObject<M['model']>>>();
    return body as Partial<ModelObject<M['model']>>;
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
   * Lifecycle hook: called before update operation.
   * Override to transform data before saving.
   */
  async before(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after update operation.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Optional transform function applied to the updated item before response.
   * Override to customize serialization.
   *
   * @example
   * ```ts
   * protected transform(item: User): unknown {
   *   return {
   *     ...item,
   *     fullName: `${item.firstName} ${item.lastName}`,
   *     updatedAt: item.updatedAt.toISOString()
   *   };
   * }
   * ```
   */
  protected transform(item: ModelObject<M['model']>): unknown {
    return item;
  }

  /**
   * Updates the resource in the database.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract update(
    lookupValue: string,
    data: Partial<ModelObject<M['model']>>,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Finds the existing record for audit logging.
   * Override in ORM-specific subclasses if audit logging is enabled.
   */
  protected async findExisting(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null> {
    // Default implementation returns null - override in adapter
    return null;
  }

  /**
   * Processes nested write operations for a relation.
   * Override in ORM-specific subclasses to implement nested writes.
   *
   * @param parentId - The ID of the parent record
   * @param relationName - The name of the relation
   * @param relationConfig - The relation configuration
   * @param operations - The nested operations (create, update, delete, etc.)
   * @param tx - Optional transaction context
   * @returns The result of nested operations
   */
  protected async processNestedWrites(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
    tx?: unknown
  ): Promise<NestedWriteResult> {
    // Default implementation does nothing - override in adapter
    getLogger().warn(`Nested writes not implemented for ${relationName}. Override processNestedWrites() in your adapter.`);
    return {
      created: [],
      updated: [],
      deleted: [],
      connected: [],
      disconnected: [],
    };
  }

  /**
   * Main handler for the update operation.
   */
  async handle(): Promise<Response> {

    // Validate tenant ID if multi-tenancy is enabled
    const tenantId = this.validateTenantId();

    const lookupValue = await this.getLookupValue();
    const additionalFilters = await this.getAdditionalFilters();

    // Inject tenant filter if multi-tenancy is enabled
    if (tenantId) {
      const config = this.getMultiTenantConfig();
      additionalFilters[config.field] = tenantId;
    }

    const rawData = await this.getObject();

    // Extract nested data from request
    const { mainData, nestedData } = this.extractNestedData(
      rawData as Record<string, unknown>
    );

    // Fetch existing record for audit logging, versioning, and ETag (before update)
    let previousRecord: ModelObject<M['model']> | null = null;
    if (this.isAuditEnabled() || this.isVersioningEnabled() || this.etagEnabled) {
      previousRecord = await this.findExisting(lookupValue, additionalFilters);
    }

    // ETag: Check If-Match for optimistic concurrency control
    if (this.etagEnabled && previousRecord) {
      const ifMatch = this.getContext().req.header('If-Match');
      if (ifMatch) {
        const currentEtag = await generateETag(previousRecord);
        if (!matchesIfMatch(ifMatch, currentEtag)) {
          return this.error(
            'Resource has been modified by another request',
            'CONFLICT',
            409
          );
        }
      }
    }

    // Save version history before update
    let newVersion: number | undefined;
    if (this.isVersioningEnabled() && previousRecord) {
      const versionManager = this.getVersionManager();
      const parentId = this.getParentId(previousRecord);
      if (parentId !== null) {
        newVersion = await versionManager.saveVersion(
          parentId,
          previousRecord as Record<string, unknown>,
          undefined, // No previous-previous record needed
          this.getVersioningUserId()
        );
      }
    }

    // Process main record update
    let data = mainData as Partial<ModelObject<M['model']>>;

    // Increment version field if versioning is enabled
    if (this.isVersioningEnabled() && newVersion !== undefined) {
      const versionField = this.getVersioningConfig().field;
      (data as Record<string, unknown>)[versionField] = newVersion;
    }

    data = await this.before(data);

    let obj = await this.update(lookupValue, data, additionalFilters);

    if (!obj) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Get the parent ID for nested writes
    const parentId = this.getParentId(obj);

    // Process nested writes
    const nestedResults: Record<string, NestedWriteResult> = {};
    if (Object.keys(nestedData).length > 0 && parentId !== null) {
      for (const [relationName, operations] of Object.entries(nestedData)) {
        if (operations === undefined || operations === null) continue;

        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        // Parse the operations - could be direct data or operation object
        let parsedOps: NestedUpdateInput;
        if (isDirectNestedData(operations)) {
          // Direct data - treat as create
          parsedOps = { create: operations as Record<string, unknown> | Record<string, unknown>[] };
        } else {
          parsedOps = operations as NestedUpdateInput;
        }

        const result = await this.processNestedWrites(
          parentId,
          relationName,
          relationConfig,
          parsedOps
        );

        nestedResults[relationName] = result;
      }
    }

    // Attach nested results to the response
    if (Object.keys(nestedResults).length > 0) {
      for (const [relationName, result] of Object.entries(nestedResults)) {
        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        // Attach created/updated records to response
        if (relationConfig.type === 'hasMany') {
          (obj as Record<string, unknown>)[relationName] = [
            ...result.created,
            ...result.updated,
          ];
        } else {
          (obj as Record<string, unknown>)[relationName] =
            result.created[0] || result.updated[0] || null;
        }
      }
    }

    // Handle after hook based on mode
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(obj)));
    } else {
      obj = await this.after(obj);
    }

    // Audit logging
    if (this.isAuditEnabled() && parentId !== null && previousRecord) {
      const auditLogger = this.getAuditLogger();
      this.runAfterResponse(auditLogger.logUpdate(
        this._meta.model.tableName,
        parentId,
        previousRecord as Record<string, unknown>,
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

    // Add ETag header on response
    if (this.etagEnabled) {
      const etag = await generateETag(result);
      this.getContext().header('ETag', etag);
    }

    return this.success(result);
  }

  /**
   * Gets the parent ID from the record.
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
