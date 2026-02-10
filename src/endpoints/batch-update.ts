import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, HookMode, NormalizedSoftDeleteConfig, NormalizedAuditConfig } from '../core/types';
import { getSoftDeleteConfig, getAuditConfig } from '../core/types';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Item format for batch updates.
 */
export interface BatchUpdateItem<T = unknown> {
  /** The ID (or lookup value) of the record to update */
  id: string;
  /** The fields to update */
  data: Partial<T>;
}

/**
 * Result of a batch update operation.
 */
export interface BatchUpdateResult<T = unknown> {
  /** Successfully updated records */
  updated: T[];
  /** Count of updated records */
  count: number;
  /** Records that were not found */
  notFound?: string[];
  /** Errors encountered during update */
  errors?: Array<{ id: string; error: string }>;
}

/**
 * Base endpoint for batch updating resources.
 * Extend this class and implement the `batchUpdate` method for your ORM.
 *
 * Accepts an array of {id, data} objects and updates them all.
 */
export abstract class BatchUpdateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** Maximum number of records that can be updated in a single request */
  protected maxBatchSize: number = 100;

  /** Whether to stop on first error or continue with remaining items */
  protected stopOnError: boolean = false;

  /** The field used to identify records */
  protected lookupField: string = 'id';

  /** Fields that can be updated (whitelist) */
  protected allowedUpdateFields?: string[];

  /** Fields that cannot be updated (blacklist) */
  protected blockedUpdateFields?: string[];

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
   * Returns the request body schema for batch updates.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    const dataSchema = this._meta.fields || this._meta.model.schema;
    return z.object({
      items: z.array(z.object({
        id: z.string(),
        data: dataSchema.partial(),
      })).min(1).max(this.maxBatchSize),
    }) as unknown as ZodObject<ZodRawShape>;
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
        },
      },
      responses: {
        200: {
          description: 'Resources updated successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  updated: z.array(this._meta.model.schema),
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
                  updated: z.array(this._meta.model.schema),
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
   * Gets the array of update items from the request body.
   */
  protected async getItems(): Promise<BatchUpdateItem<ModelObject<M['model']>>[]> {
    const { body } = await this.getValidatedData<{ items: BatchUpdateItem<ModelObject<M['model']>>[] }>();
    return body?.items || [];
  }

  /**
   * Filters update data to only allowed fields.
   */
  protected filterUpdateData(
    data: Partial<ModelObject<M['model']>>
  ): Partial<ModelObject<M['model']>> {
    let filtered = { ...data } as Record<string, unknown>;

    // Apply whitelist
    if (this.allowedUpdateFields) {
      const allowed = new Set(this.allowedUpdateFields);
      filtered = Object.fromEntries(
        Object.entries(filtered).filter(([key]) => allowed.has(key))
      );
    }

    // Apply blacklist
    if (this.blockedUpdateFields) {
      for (const field of this.blockedUpdateFields) {
        delete filtered[field];
      }
    }

    // Never allow updating primary keys
    for (const pk of this._meta.model.primaryKeys) {
      delete filtered[pk];
    }

    return filtered as Partial<ModelObject<M['model']>>;
  }

  /**
   * Lifecycle hook: called before each item is updated.
   * Override to transform data before update.
   */
  async before(
    _id: string,
    data: Partial<ModelObject<M['model']>>,
    _tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after each item is updated.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    _tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Updates multiple resources in the database.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param items - Array of {id, data} to update
   * @param tx - Optional transaction context
   * @returns Object with updated items and not found IDs
   */
  abstract batchUpdate(
    items: BatchUpdateItem<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<{ updated: ModelObject<M['model']>[]; notFound: string[] }>;

  /**
   * Main handler for the batch update operation.
   */
  async handle(): Promise<Response> {

    const items = await this.getItems();
    const errors: Array<{ id: string; error: string }> = [];

    // Apply field filtering and before hooks
    const processedItems: BatchUpdateItem<ModelObject<M['model']>>[] = [];
    for (const item of items) {
      try {
        const filteredData = this.filterUpdateData(item.data);
        const processed = await this.before(item.id, filteredData);
        processedItems.push({ id: item.id, data: processed });
      } catch (err) {
        if (this.stopOnError) {
          throw err;
        }
        errors.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Update all items
    const { updated, notFound } = await this.batchUpdate(processedItems);

    // Apply after hooks
    const results: ModelObject<M['model']>[] = [];
    for (const item of updated) {
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
            record: record as Record<string, unknown>,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (auditRecords.length > 0) {
        this.runAfterResponse(auditLogger.logBatch(
          'batch_update',
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
        updated: serialized,
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
