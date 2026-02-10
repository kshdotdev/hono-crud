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
  CascadeAction,
} from '../core/types';
import { getSoftDeleteConfig, getAuditConfig, getMultiTenantConfig, extractTenantId } from '../core/types';
import { NotFoundException, ConflictException } from '../core/exceptions';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Result of cascade operations during delete.
 */
export interface CascadeResult {
  /** Relations where records were deleted */
  deleted: Record<string, number>;
  /** Relations where foreign keys were set to null */
  nullified: Record<string, number>;
}

/**
 * Base endpoint for deleting resources.
 * Extend this class and implement the `delete` method for your ORM.
 *
 * Supports soft delete when the model has `softDelete` configured.
 * When soft delete is enabled, the `delete` method should set the
 * deletion timestamp instead of removing the record.
 *
 * Supports cascade operations when relations have `cascade` configured:
 * - `cascade`: Delete related records
 * - `setNull`: Set foreign key to null
 * - `restrict`: Prevent delete if related records exist
 * - `noAction`: Do nothing (default)
 *
 * @example
 * ```typescript
 * const UserModel = defineModel({
 *   tableName: 'users',
 *   schema: UserSchema,
 *   primaryKeys: ['id'],
 *   relations: {
 *     posts: {
 *       type: 'hasMany',
 *       model: 'posts',
 *       foreignKey: 'authorId',
 *       cascade: { onDelete: 'cascade' }, // Delete posts when user is deleted
 *     },
 *     profile: {
 *       type: 'hasOne',
 *       model: 'profiles',
 *       foreignKey: 'userId',
 *       cascade: { onDelete: 'cascade' },
 *     },
 *   },
 * });
 * ```
 */
export abstract class DeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  // Lookup configuration
  protected lookupField: string = 'id';
  protected lookupFields?: string[];
  protected additionalFilters?: string[];

  // Hook execution mode
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

  /**
   * Whether to include cascade results in the response.
   * @default false
   */
  protected includeCascadeResults: boolean = false;

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
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Gets relations that have cascade configuration for the given action type.
   */
  protected getCascadeRelations(
    actionType: 'onDelete' | 'onSoftDelete'
  ): Array<{ name: string; config: RelationConfig; action: CascadeAction }> {
    const relations = this._meta.model.relations;
    if (!relations) return [];

    return Object.entries(relations)
      .filter(([_, config]) => {
        const action = config.cascade?.[actionType];
        return action && action !== 'noAction';
      })
      .map(([name, config]) => ({
        name,
        config,
        action: config.cascade![actionType]!,
      }));
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const resultSchema = this.includeCascadeResults
      ? z.object({
          deleted: z.literal(true),
          cascade: z
            .object({
              deleted: z.record(z.string(), z.number()),
              nullified: z.record(z.string(), z.number()),
            })
            .optional(),
        })
      : z.object({
          deleted: z.literal(true),
        });

    return {
      ...this.schema,
      request: {
        params: this.getParamsSchema(),
      },
      responses: {
        200: {
          description: 'Resource deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: resultSchema,
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
        409: {
          description: 'Cannot delete - related records exist (restrict)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(false),
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                  details: z.object({
                    relation: z.string(),
                    count: z.number(),
                  }).optional(),
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
   * Lifecycle hook: called before delete operation.
   * Override to perform checks or side effects before deleting.
   */
  async before(
    _lookupValue: string,
    _tx?: unknown
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Lifecycle hook: called after delete operation.
   * Override to perform cleanup or side effects after deleting.
   */
  async after(
    _deletedItem: ModelObject<M['model']>,
    _cascadeResult?: CascadeResult,
    _tx?: unknown
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Counts related records for a relation.
   * Used to check for restrict cascade action.
   * Must be implemented by ORM-specific subclasses.
   */
  protected async countRelated(
    _parentId: string | number,
    relationName: string,
    _relationConfig: RelationConfig,
    _tx?: unknown
  ): Promise<number> {
    // Default implementation returns 0 - override in adapter
    getLogger().warn(`countRelated not implemented for ${relationName}. Override in your adapter for restrict cascade to work.`);
    return 0;
  }

  /**
   * Deletes related records for cascade delete.
   * Must be implemented by ORM-specific subclasses.
   */
  protected async deleteRelated(
    _parentId: string | number,
    relationName: string,
    _relationConfig: RelationConfig,
    _tx?: unknown
  ): Promise<number> {
    // Default implementation returns 0 - override in adapter
    getLogger().warn(`deleteRelated not implemented for ${relationName}. Override in your adapter for cascade delete to work.`);
    return 0;
  }

  /**
   * Sets foreign key to null for related records (setNull cascade).
   * Must be implemented by ORM-specific subclasses.
   */
  protected async nullifyRelated(
    _parentId: string | number,
    relationName: string,
    _relationConfig: RelationConfig,
    _tx?: unknown
  ): Promise<number> {
    // Default implementation returns 0 - override in adapter
    getLogger().warn(`nullifyRelated not implemented for ${relationName}. Override in your adapter for setNull cascade to work.`);
    return 0;
  }

  /**
   * Processes cascade and setNull operations for all configured relations.
   * Note: Restrict constraints should be checked separately before deletion
   * using checkRestrictConstraints().
   */
  protected async processCascade(
    parentId: string | number,
    isSoftDelete: boolean,
    tx?: unknown
  ): Promise<CascadeResult> {
    const actionType = isSoftDelete ? 'onSoftDelete' : 'onDelete';
    const cascadeRelations = this.getCascadeRelations(actionType);
    const result: CascadeResult = {
      deleted: {},
      nullified: {},
    };

    // Process cascade and setNull actions (restrict is checked before delete)
    for (const { name, config, action } of cascadeRelations) {
      if (action === 'cascade') {
        const deletedCount = await this.deleteRelated(parentId, name, config, tx);
        if (deletedCount > 0) {
          result.deleted[name] = deletedCount;
        }
      } else if (action === 'setNull') {
        const nullifiedCount = await this.nullifyRelated(parentId, name, config, tx);
        if (nullifiedCount > 0) {
          result.nullified[name] = nullifiedCount;
        }
      }
    }

    return result;
  }

  /**
   * Gets the parent ID from the record.
   */
  protected getParentId(record: ModelObject<M['model']>): string | number | null {
    const pk = this._meta.model.primaryKeys[0];
    const id = (record as Record<string, unknown>)[pk];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return null;
  }

  /**
   * Finds the record to be deleted (without deleting it).
   * Used to check restrict constraints before deletion.
   * Must be implemented by ORM-specific subclasses.
   */
  abstract findForDelete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Deletes the resource from the database.
   * Must be implemented by ORM-specific subclasses.
   * Returns the deleted item or null if not found.
   */
  abstract delete(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Checks restrict constraints before deletion.
   * Throws ConflictException if any restrict relation has related records.
   */
  protected async checkRestrictConstraints(
    parentId: string | number,
    isSoftDelete: boolean,
    tx?: unknown
  ): Promise<void> {
    const actionType = isSoftDelete ? 'onSoftDelete' : 'onDelete';
    const cascadeRelations = this.getCascadeRelations(actionType);

    for (const { name, config, action } of cascadeRelations) {
      if (action === 'restrict') {
        const count = await this.countRelated(parentId, name, config, tx);
        if (count > 0) {
          throw new ConflictException(
            `Cannot delete: ${count} related ${name} record(s) exist. ` +
            `Remove them first or change the cascade configuration.`,
            { relation: name, count }
          );
        }
      }
    }
  }

  /**
   * Main handler for the delete operation.
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

    const isSoftDelete = this.isSoftDeleteEnabled();

    // First, find the record to get its ID for constraint checks
    const existingItem = await this.findForDelete(lookupValue, additionalFilters);

    if (!existingItem) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    const parentId = this.getParentId(existingItem);

    // Check restrict constraints BEFORE deletion
    if (parentId !== null) {
      await this.checkRestrictConstraints(parentId, isSoftDelete);
    }

    await this.before(lookupValue);

    // Now perform the actual delete
    const deletedItem = await this.delete(lookupValue, additionalFilters);

    if (!deletedItem) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Process cascade and setNull operations (restrict already checked)
    let cascadeResult: CascadeResult | undefined;

    if (parentId !== null) {
      cascadeResult = await this.processCascade(parentId, isSoftDelete);
    }

    // Handle after hook based on mode
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(deletedItem, cascadeResult)));
    } else {
      await this.after(deletedItem, cascadeResult);
    }

    // Audit logging
    if (this.isAuditEnabled() && parentId !== null) {
      const auditLogger = this.getAuditLogger();
      this.runAfterResponse(auditLogger.logDelete(
        this._meta.model.tableName,
        parentId,
        deletedItem as Record<string, unknown>,
        this.getAuditUserId()
      ));
    }

    // Build response
    const response: Record<string, unknown> = { deleted: true };

    if (this.includeCascadeResults && cascadeResult) {
      const hasDeleted = Object.keys(cascadeResult.deleted).length > 0;
      const hasNullified = Object.keys(cascadeResult.nullified).length > 0;
      if (hasDeleted || hasNullified) {
        response.cascade = cascadeResult;
      }
    }

    return this.success(response);
  }
}
