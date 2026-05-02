import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { CrudEndpoint } from './base';
import { getLogger } from '../core/logger';
import type {MetaInput, OpenAPIRouteSchema, HookMode, HookContext, RelationConfig, CascadeAction} from '../core/types';
import { NotFoundException, ConflictException } from '../core/exceptions';
import type { ModelObject } from './types';

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
> extends CrudEndpoint<E, M> {

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
   */

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
   *
   * The optional `hookCtx` carries the in-flight transaction handle
   * (`hookCtx.db.tx`) plus tenant/org/user/agent identifiers.
   */
  async before(
    _lookupValue: string,
    _hookCtx: HookContext
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Lifecycle hook: called after delete operation. Throwing inside this
   * hook rolls back the parent DELETE only when `afterHookMode ===
   * 'sequential'` AND the adapter wraps in a transaction.
   *
   * `cascadeResult` is `undefined` when the deleted record had no
   * primary-key value (cascade processing was skipped).
   */
  async after(
    _deletedItem: ModelObject<M['model']>,
    _cascadeResult: CascadeResult | undefined,
    _hookCtx: HookContext
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

    // Run write-policy gate before deletion. Throws 403 on denial.
    await this.applyWritePolicy(existingItem);

    const hookCtx = this.buildHookContext();
    await this.before(lookupValue, hookCtx);

    // Now perform the actual delete
    const deletedItem = await this.delete(lookupValue, additionalFilters, hookCtx.db.tx);

    if (!deletedItem) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Process cascade and setNull operations (restrict already checked)
    let cascadeResult: CascadeResult | undefined;

    if (parentId !== null) {
      cascadeResult = await this.processCascade(parentId, isSoftDelete);
    }

    // Fire-and-forget cannot trigger rollback. Use 'sequential' to opt
    // into transactional rollback when the adapter wraps in a tx.
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(deletedItem, cascadeResult, hookCtx)));
    } else {
      await this.after(deletedItem, cascadeResult, hookCtx);
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

    // Emit deleted event
    if (parentId !== null) {
      this.runAfterResponse(
        this.emitEvent('deleted', { recordId: parentId, previousData: deletedItem })
      );
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
