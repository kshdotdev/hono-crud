import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, HookMode, NormalizedAuditConfig } from '../core/types';
import { getAuditConfig } from '../core/types';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Base endpoint for batch creating resources.
 * Extend this class and implement the `batchCreate` method for your ORM.
 *
 * Accepts an array of objects and creates them all, returning the created records.
 */
export abstract class BatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** Maximum number of records that can be created in a single request */
  protected maxBatchSize: number = 100;

  /** Whether to stop on first error or continue with remaining items */
  protected stopOnError: boolean = true;

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
   * Gets the record ID from a created record.
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
   * Returns the request body schema for batch creation.
   * Makes primary keys optional since they can be auto-generated.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    const baseSchema = this._meta.fields || this._meta.model.schema;

    // Make primary keys optional for creation
    const primaryKeys = this._meta.model.primaryKeys;
    const partialKeys: Record<string, true> = {};
    for (const pk of primaryKeys) {
      partialKeys[pk] = true;
    }

    // Use partial for primary keys only
    const itemSchema = baseSchema.partial(partialKeys);

    return z.object({
      items: z.array(itemSchema).min(1).max(this.maxBatchSize),
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
        201: {
          description: 'Resources created successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  created: z.array(this._meta.model.schema),
                  count: z.number(),
                }),
              }),
            },
          },
        },
        207: {
          description: 'Partial success (some items failed)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  created: z.array(this._meta.model.schema),
                  count: z.number(),
                  errors: z.array(z.object({
                    index: z.number(),
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
   * Gets the array of items from the request body.
   */
  protected async getItems(): Promise<Partial<ModelObject<M['model']>>[]> {
    const { body } = await this.getValidatedData<{ items: Partial<ModelObject<M['model']>>[] }>();
    return body?.items || [];
  }

  /**
   * Lifecycle hook: called before each item is created.
   * Override to transform data before creation.
   */
  async before(
    data: Partial<ModelObject<M['model']>>,
    index: number,
    tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after each item is created.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    index: number,
    tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Optional transform function applied to each created item before response.
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
   * Creates multiple resources in the database.
   * Must be implemented by ORM-specific subclasses.
   *
   * @param items - Array of items to create
   * @param tx - Optional transaction context
   * @returns Array of created items
   */
  abstract batchCreate(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<ModelObject<M['model']>[]>;

  /**
   * Main handler for the batch create operation.
   */
  async handle(): Promise<Response> {

    let items = await this.getItems();
    const errors: Array<{ index: number; error: string }> = [];

    // Apply before hooks
    const processedItems: Partial<ModelObject<M['model']>>[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const processed = await this.before(items[i], i);
        processedItems.push(processed);
      } catch (err) {
        if (this.stopOnError) {
          throw err;
        }
        errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Create all items
    let created = await this.batchCreate(processedItems);

    // Apply after hooks
    const results: ModelObject<M['model']>[] = [];
    for (let i = 0; i < created.length; i++) {
      try {
        if (this.afterHookMode === 'fire-and-forget') {
          this.runAfterResponse(Promise.resolve(this.after(created[i], i)));
          results.push(created[i]);
        } else {
          results.push(await this.after(created[i], i));
        }
      } catch (err) {
        if (this.stopOnError) {
          throw err;
        }
        errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
        results.push(created[i]);
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
          'batch_create',
          this._meta.model.tableName,
          auditRecords,
          this.getAuditUserId()
        ));
      }
    }

    // Apply serializer if defined
    const serializedItems = this._meta.model.serializer
      ? results.map((item) => this._meta.model.serializer!(item) as ModelObject<M['model']>)
      : results;

    // Apply transform to each item
    const transformed = serializedItems.map((item) => this.transform(item as ModelObject<M['model']>));

    const response = {
      success: true as const,
      result: {
        created: transformed,
        count: transformed.length,
        ...(errors.length > 0 && { errors }),
      },
    };

    // Return 207 if there were partial errors
    const status = errors.length > 0 ? 207 : 201;
    return this.json(response, status);
  }
}
