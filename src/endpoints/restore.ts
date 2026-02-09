import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, HookMode, NormalizedSoftDeleteConfig, NormalizedAuditConfig } from '../core/types';
import { getSoftDeleteConfig, getAuditConfig } from '../core/types';
import { NotFoundException, ApiException } from '../core/exceptions';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Base endpoint for restoring soft-deleted resources.
 * Extend this class and implement the `restore` method for your ORM.
 *
 * This endpoint only works with models that have `softDelete` enabled.
 * It sets the deletion timestamp back to null, making the record visible again.
 */
export abstract class RestoreEndpoint<
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

  /**
   * Returns the path parameter schema.
   */
  protected getParamsSchema(): ZodObject<ZodRawShape> {
    return z.object({
      [this.lookupField]: z.string(),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    return {
      ...this.schema,
      request: {
        params: this.getParamsSchema(),
      },
      responses: {
        200: {
          description: 'Resource restored successfully',
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
          description: 'Soft delete not enabled or record not deleted',
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
   * Lifecycle hook: called before restore operation.
   * Override to perform checks or side effects before restoring.
   */
  async before(
    lookupValue: string,
    tx?: unknown
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Lifecycle hook: called after restore operation.
   * Override to perform side effects after restoring.
   */
  async after(
    restoredItem: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return restoredItem;
  }

  /**
   * Restores a soft-deleted resource in the database.
   * Must be implemented by ORM-specific subclasses.
   * Returns the restored item or null if not found.
   */
  abstract restore(
    lookupValue: string,
    additionalFilters?: Record<string, string>,
    tx?: unknown
  ): Promise<ModelObject<M['model']> | null>;

  /**
   * Gets the record ID from the restored item.
   */
  protected getRecordId(record: ModelObject<M['model']>): string | number | null {
    const pk = this._meta.model.primaryKeys[0];
    const id = (record as Record<string, unknown>)[pk];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return null;
  }

  /**
   * Main handler for the restore operation.
   */
  async handle(): Promise<Response> {

    // Check if soft delete is enabled
    if (!this.isSoftDeleteEnabled()) {
      throw new ApiException('Soft delete is not enabled for this model', 400, 'SOFT_DELETE_NOT_ENABLED');
    }

    const lookupValue = await this.getLookupValue();
    const additionalFilters = await this.getAdditionalFilters();

    await this.before(lookupValue);

    let restoredItem = await this.restore(lookupValue, additionalFilters);

    if (!restoredItem) {
      throw new NotFoundException(this._meta.model.tableName, lookupValue);
    }

    // Handle after hook based on mode
    if (this.afterHookMode === 'fire-and-forget') {
      this.runAfterResponse(Promise.resolve(this.after(restoredItem)));
    } else {
      restoredItem = await this.after(restoredItem);
    }

    // Audit logging
    const recordId = this.getRecordId(restoredItem);
    if (this.isAuditEnabled() && recordId !== null) {
      const auditLogger = this.getAuditLogger();
      this.runAfterResponse(auditLogger.logRestore(
        this._meta.model.tableName,
        recordId,
        restoredItem as Record<string, unknown>,
        this.getAuditUserId()
      ));
    }

    // Apply serializer if defined
    const result = this._meta.model.serializer
      ? this._meta.model.serializer(restoredItem)
      : restoredItem;

    return this.success(result);
  }
}
