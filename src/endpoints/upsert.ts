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
  NormalizedMultiTenantConfig,
  RelationConfig,
  NestedWriteResult,
  NestedUpdateInput,
} from '../core/types';
import { getSoftDeleteConfig, getAuditConfig, applyComputedFields, extractNestedData, isDirectNestedData, getMultiTenantConfig, extractTenantId } from '../core/types';
import { getSchemaFields, type ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Result of an upsert operation indicating whether it was a create or update.
 */
export interface UpsertResult<T> {
  data: T;
  created: boolean;
}

/**
 * Base endpoint for upsert (create or update) operations.
 * Extend this class and implement the `upsert` method for your ORM.
 *
 * The upsert operation will:
 * - Create a new record if no matching record exists
 * - Update the existing record if a match is found
 *
 * The matching is done using the lookup field(s) specified.
 *
 * @example
 * ```typescript
 * // Upsert by email - creates if not exists, updates if exists
 * PUT /users
 * {
 *   "email": "john@example.com",
 *   "name": "John Doe"
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Upsert with composite key
 * PUT /subscriptions
 * {
 *   "userId": "123",
 *   "planId": "456",
 *   "status": "active"
 * }
 * ```
 */
export abstract class UpsertEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /**
   * Fields used to find existing record for upsert.
   * If record with these field values exists, it will be updated.
   * Otherwise, a new record will be created.
   *
   * Defaults to primary keys if not specified.
   */
  protected upsertKeys?: string[];

  /**
   * Whether to use native database upsert (ON CONFLICT DO UPDATE / upsert).
   * When enabled, uses a single atomic query instead of find-then-insert/update.
   *
   * Benefits:
   * - Single database round-trip instead of two
   * - Atomic operation prevents race conditions
   * - Better performance for high-concurrency scenarios
   *
   * Limitations:
   * - Cannot accurately determine if record was created or updated (defaults to created=false)
   * - Soft delete handling may require additional logic
   * - beforeCreate/beforeUpdate hooks are not called (only `before` hook)
   *
   * @default false
   */
  protected useNativeUpsert: boolean = false;

  /**
   * Fields that can only be set on create, not on update.
   * Useful for fields like 'createdAt' or 'createdBy'.
   */
  protected createOnlyFields?: string[];

  /**
   * Fields that can only be set on update, not on create.
   * Useful for fields like 'updatedAt' or 'version'.
   */
  protected updateOnlyFields?: string[];

  // Hook execution mode
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

  // Nested writes configuration
  /** Relations that allow nested writes on upsert. */
  protected allowNestedWrites: string[] = [];

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
   * Injects tenant ID into the data object.
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
   * Returns the upsert keys used to find existing records.
   * Defaults to primary keys if not specified.
   */
  protected getUpsertKeys(): string[] {
    return this.upsertKeys || this._meta.model.primaryKeys;
  }

  /**
   * Returns the Zod schema for request body.
   * Includes all fields needed for both create and update.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    let baseSchema: ZodObject<ZodRawShape>;

    if (this._meta.fields) {
      baseSchema = this._meta.fields;
    } else {
      // For upsert, we need upsert keys to be required
      // Other fields can be optional (for partial updates)
      const upsertKeys = this.getUpsertKeys();
      const allFields = getSchemaFields(this._meta.model.schema, []);

      // Make non-upsert-key fields optional
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(allFields.shape)) {
        if (upsertKeys.includes(key)) {
          // Upsert keys are required
          shape[key] = value as z.ZodTypeAny;
        } else {
          // Other fields are optional
          shape[key] = (value as z.ZodTypeAny).optional();
        }
      }

      baseSchema = z.object(shape) as ZodObject<ZodRawShape>;
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

      const relatedSchema = relationConfig.schema;

      // For upsert, allow both direct data and operation objects
      const nestedSchema = z.union([
        // Direct data (treated as upsert)
        relationConfig.type === 'hasMany'
          ? z.array(relatedSchema.partial())
          : relatedSchema.partial(),
        // Operation object
        z.object({
          create: z.union([relatedSchema.partial(), z.array(relatedSchema.partial())]).optional(),
          update: z.array(relatedSchema.partial().extend({ id: z.union([z.string(), z.number()]) })).optional(),
          upsert: z.union([relatedSchema.partial(), z.array(relatedSchema.partial())]).optional(),
          delete: z.array(z.union([z.string(), z.number()])).optional(),
          connect: z.array(z.union([z.string(), z.number()])).optional(),
          disconnect: z.array(z.union([z.string(), z.number()])).optional(),
          set: relatedSchema.partial().nullable().optional(),
        }),
      ]).optional();

      shape[relationName] = nestedSchema;
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Gets the list of relations that allow nested writes.
   */
  protected getNestedWritableRelations(): string[] {
    if (this.allowNestedWrites.length > 0) {
      return this.allowNestedWrites;
    }

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
          description: 'Resource updated (upsert)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: this._meta.model.schema,
                created: z.literal(false),
              }),
            },
          },
        },
        201: {
          description: 'Resource created (upsert)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: this._meta.model.schema,
                created: z.literal(true),
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
  protected async getObject(): Promise<Partial<ModelObject<M['model']>>> {
    const { body } = await this.getValidatedData<Partial<ModelObject<M['model']>>>();
    return body as Partial<ModelObject<M['model']>>;
  }

  /**
   * Lifecycle hook: called before upsert operation (both create and update).
   * Override to transform data before saving.
   */
  async before(
    data: Partial<ModelObject<M['model']>>,
    isCreate: boolean,
    tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called before create (only when creating).
   */
  async beforeCreate(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called before update (only when updating).
   */
  async beforeUpdate(
    data: Partial<ModelObject<M['model']>>,
    existing: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after upsert operation.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    created: boolean,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Finds an existing record by upsert keys.
   * Returns null if no record exists.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract findExisting(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Creates a new record.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract create(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>>;

  /**
   * Updates an existing record.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract update(
    existing: ModelObject<M['model']>,
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>>;

  /**
   * Performs a native database upsert operation.
   * Override in ORM-specific subclasses to use native ON CONFLICT DO UPDATE.
   *
   * The default implementation falls back to the find-then-insert/update pattern.
   *
   * @param data The data to upsert
   * @param tx Optional transaction
   * @returns The upserted record (created flag may not be accurate with native upsert)
   */
  protected async nativeUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<UpsertResult<ModelObject<M['model']>>> {
    // Default implementation falls back to non-native upsert
    // ORM adapters should override this method
    getLogger().warn('Native upsert not implemented for this adapter. Falling back to find-then-insert/update pattern.');
    return this.performStandardUpsert(data, tx);
  }

  /**
   * Performs the standard find-then-insert/update upsert pattern.
   * This is the non-native fallback implementation.
   */
  protected async performStandardUpsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<UpsertResult<ModelObject<M['model']>>> {
    const existing = await this.findExisting(data, tx);

    if (existing) {
      // Filter out create-only fields for update
      let updateData = { ...data };
      if (this.createOnlyFields) {
        for (const field of this.createOnlyFields) {
          delete updateData[field as keyof typeof updateData];
        }
      }

      updateData = await this.beforeUpdate(updateData, existing, tx);
      const updated = await this.update(existing, updateData, tx);
      return { data: updated, created: false };
    } else {
      // Filter out update-only fields for create
      let createData = { ...data };
      if (this.updateOnlyFields) {
        for (const field of this.updateOnlyFields) {
          delete createData[field as keyof typeof createData];
        }
      }

      createData = await this.beforeCreate(createData, tx);
      const created = await this.create(createData, tx);
      return { data: created, created: true };
    }
  }

  /**
   * Performs the upsert operation.
   * Uses native upsert when enabled, otherwise falls back to find-then-insert/update.
   */
  async upsert(
    data: Partial<ModelObject<M['model']>>,
    tx?: unknown
  ): Promise<UpsertResult<ModelObject<M['model']>>> {
    if (this.useNativeUpsert) {
      return this.nativeUpsert(data, tx);
    }
    return this.performStandardUpsert(data, tx);
  }

  /**
   * Processes nested write operations for a relation.
   * Override in ORM-specific subclasses to implement nested writes.
   */
  protected async processNestedWrites(
    parentId: string | number,
    relationName: string,
    relationConfig: RelationConfig,
    operations: NestedUpdateInput,
    tx?: unknown
  ): Promise<NestedWriteResult> {
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
   * Main handler for the upsert operation.
   */
  async handle(): Promise<Response> {

    // Validate tenant ID if multi-tenancy is enabled
    this.validateTenantId();

    const rawData = await this.getObject();

    // Extract nested data from request
    const { mainData, nestedData } = this.extractNestedData(
      rawData as Record<string, unknown>
    );

    // Process main record upsert
    let data = mainData as Partial<ModelObject<M['model']>>;

    // Inject tenant ID if multi-tenancy is enabled
    data = this.injectTenantId(data as Record<string, unknown>) as Partial<ModelObject<M['model']>>;

    // Find existing to determine if create or update (with tenant filter)
    const existing = await this.findExisting(data);
    const isCreate = !existing;

    // Call common before hook
    data = await this.before(data, isCreate);

    // Perform upsert
    const result = await this.upsert(data);
    let obj = result.data;

    // Get the parent ID for nested writes
    const parentId = this.getParentId(obj);

    // Process nested writes
    const nestedResults: Record<string, NestedWriteResult> = {};
    if (Object.keys(nestedData).length > 0 && parentId !== null) {
      for (const [relationName, operations] of Object.entries(nestedData)) {
        if (operations === undefined || operations === null) continue;

        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        let parsedOps: NestedUpdateInput;
        if (isDirectNestedData(operations)) {
          // Direct data - treat as upsert/create
          parsedOps = { create: operations as Record<string, unknown> | Record<string, unknown>[] };
        } else {
          parsedOps = operations as NestedUpdateInput;
        }

        const nestedResult = await this.processNestedWrites(
          parentId,
          relationName,
          relationConfig,
          parsedOps
        );

        nestedResults[relationName] = nestedResult;
      }
    }

    // Attach nested results to the response
    if (Object.keys(nestedResults).length > 0) {
      for (const [relationName, nestedResult] of Object.entries(nestedResults)) {
        const relationConfig = this._meta.model.relations?.[relationName];
        if (!relationConfig) continue;

        if (relationConfig.type === 'hasMany') {
          (obj as Record<string, unknown>)[relationName] = [
            ...nestedResult.created,
            ...nestedResult.updated,
          ];
        } else {
          (obj as Record<string, unknown>)[relationName] =
            nestedResult.created[0] || nestedResult.updated[0] || null;
        }
      }
    }

    // Handle after hook
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(obj, result.created)));
    } else {
      obj = await this.after(obj, result.created);
    }

    // Audit logging
    if (this.isAuditEnabled() && parentId !== null) {
      const auditLogger = this.getAuditLogger();
      this.runAfterResponse(auditLogger.logUpsert(
        this._meta.model.tableName,
        parentId,
        obj as Record<string, unknown>,
        existing as Record<string, unknown> | undefined,
        result.created,
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

    // Return with created flag and appropriate status code
    return this.json(
      {
        success: true as const,
        result: serialized,
        created: result.created,
      },
      result.created ? 201 : 200
    );
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
