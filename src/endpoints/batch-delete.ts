import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, HookMode, NormalizedSoftDeleteConfig, NormalizedAuditConfig } from '../core/types';
import { getSoftDeleteConfig, getAuditConfig } from '../core/types';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Result of a batch delete operation.
 */
export interface BatchDeleteResult<T = unknown> {
  /** Successfully deleted records */
  deleted: T[];
  /** Count of deleted records */
  count: number;
  /** IDs that were not found */
  notFound?: string[];
  /** Errors encountered during deletion */
  errors?: Array<{ id: string; error: string }>;
}

/**
 * Base endpoint for batch deleting resources.
 * Extend this class and implement the `batchDelete` method for your ORM.
 *
 * Accepts an array of IDs and deletes them all.
 * Supports soft delete when the model has `softDelete` configured.
 */
export abstract class BatchDeleteEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** Maximum number of records that can be deleted in a single request */
  protected maxBatchSize: number = 100;

  /** Whether to stop on first error or continue with remaining items */
  protected stopOnError: boolean = false;

  /** The field used to identify records */
  protected lookupField: string = 'id';

  /** Hook execution mode */
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
   * Gets the record ID from a record.
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
   * Returns the request body schema for batch deletion.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    return z.object({
      ids: z.array(z.string()).min(1).max(this.maxBatchSize),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const softDelete = this.isSoftDeleteEnabled();
    return {
      ...this.schema,
      request: {
        body: {
          content: {
            'application/json': {
              schema: this.getBodySchema(),
            },
          },
        },
      },
      responses: {
        200: {
          description: softDelete
            ? 'Resources soft-deleted successfully'
            : 'Resources deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  deleted: z.array(this._meta.model.schema),
                  count: z.number(),
                  notFound: z.array(z.string()).optional(),
                }),
              }),
            },
          },
        },
        207: {
          description: 'Partial success (some items failed or not found)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  deleted: z.array(this._meta.model.schema),
                  count: z.number(),
                  notFound: z.array(z.string()).optional(),
                  errors: z.array(z.object({
                    id: z.string(),
                    error: z.string(),
                  })).optional(),
                }),
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
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Gets the array of IDs from the request body.
   */
  protected async getIds(): Promise<string[]> {
    const { body } = await this.getValidatedData<{ ids: string[] }>();
    return body?.ids || [];
  }

  /**
   * Lifecycle hook: called before each item is deleted.
   * Override to perform checks or side effects.
   */
  async before(
    id: string,
    tx?: unknown
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Lifecycle hook: called after each item is deleted.
   * Override to perform side effects.
   */
  async after(
    data: ModelObject<M['model']>,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Deletes multiple resources from the database.
   * Must be implemented by ORM-specific subclasses.
   *
   * When soft delete is enabled, sets the deletion timestamp instead of removing.
   *
   * @param ids - Array of IDs to delete
   * @param tx - Optional transaction context
   * @returns Object with deleted items and not found IDs
   */
  abstract batchDelete(
    ids: string[],
    tx?: unknown
  ): Promise<{ deleted: ModelObject<M['model']>[]; notFound: string[] }>;

  /**
   * Main handler for the batch delete operation.
   */
  async handle(): Promise<Response> {

    const ids = await this.getIds();
    const errors: Array<{ id: string; error: string }> = [];

    // Apply before hooks
    const idsToDelete: string[] = [];
    for (const id of ids) {
      try {
        await this.before(id);
        idsToDelete.push(id);
      } catch (err) {
        if (this.stopOnError) {
          throw err;
        }
        errors.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Delete all items
    const { deleted, notFound } = await this.batchDelete(idsToDelete);

    // Apply after hooks
    const results: ModelObject<M['model']>[] = [];
    for (const item of deleted) {
      try {
        if (this.afterHookMode === 'fire-and-forget') {
          this.runAfterResponse(Promise.resolve(this.after(item)));
          results.push(item);
        } else {
          results.push(await this.after(item));
        }
      } catch (err) {
        const id = String((item as Record<string, unknown>)[this.lookupField]);
        if (this.stopOnError) {
          throw err;
        }
        errors.push({ id, error: err instanceof Error ? err.message : String(err) });
        results.push(item);
      }
    }

    // Audit logging
    if (this.isAuditEnabled()) {
      const auditLogger = this.getAuditLogger();
      const auditRecords = results
        .map((record) => {
          const recordId = this.getRecordId(record);
          if (recordId === null) return null;
          return {
            recordId,
            previousRecord: record as Record<string, unknown>,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (auditRecords.length > 0) {
        this.runAfterResponse(auditLogger.logBatch(
          'batch_delete',
          this._meta.model.tableName,
          auditRecords,
          this.getAuditUserId()
        ));
      }
    }

    // Apply serializer if defined
    const serialized = this._meta.model.serializer
      ? results.map((item) => this._meta.model.serializer!(item) as ModelObject<M['model']>)
      : results;

    const response = {
      success: true as const,
      result: {
        deleted: serialized,
        count: serialized.length,
        ...(notFound.length > 0 && { notFound }),
        ...(errors.length > 0 && { errors }),
      },
    };

    // Return 207 if there were partial errors or not found items
    const status = errors.length > 0 || notFound.length > 0 ? 207 : 200;
    return this.json(response, status);
  }
}
