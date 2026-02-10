import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import { getLogger } from '../core/logger';
import type {
  MetaInput,
  OpenAPIRouteSchema,
  HookMode,
  NormalizedAuditConfig,
} from '../core/types';
import { applyComputedFields, getAuditConfig } from '../core/types';
import { getSchemaFields, type ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';

/**
 * Result for a single item in a batch upsert operation.
 */
export interface BatchUpsertItemResult<T = Record<string, unknown>> {
  /** The upserted record */
  data: T;
  /** Whether the record was created (true) or updated (false) */
  created: boolean;
  /** Index in the original input array */
  index: number;
}

/**
 * Overall result of a batch upsert operation.
 */
export interface BatchUpsertResult<T = Record<string, unknown>> {
  /** Successfully upserted items */
  items: BatchUpsertItemResult<T>[];
  /** Number of records created */
  createdCount: number;
  /** Number of records updated */
  updatedCount: number;
  /** Total number of records processed */
  totalCount: number;
  /** Failed items (if continueOnError is true) */
  errors?: Array<{
    index: number;
    error: string;
  }>;
}

/**
 * Base endpoint for batch upsert operations.
 * Extend this class and implement the required methods for your ORM.
 *
 * Upserts multiple records in a single request - creates if not exists,
 * updates if exists (based on upsert keys).
 *
 * @example
 * ```typescript
 * // Batch upsert products by SKU
 * PUT /products/batch
 * [
 *   { "sku": "PROD-001", "name": "Product 1", "price": 29.99 },
 *   { "sku": "PROD-002", "name": "Product 2", "price": 39.99 },
 *   { "sku": "PROD-001", "name": "Product 1 Updated", "price": 24.99 }
 * ]
 *
 * // Response
 * {
 *   "success": true,
 *   "result": {
 *     "items": [...],
 *     "createdCount": 1,
 *     "updatedCount": 2,
 *     "totalCount": 3
 *   }
 * }
 * ```
 */
export abstract class BatchUpsertEndpoint<
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
   * Fields that can only be set on create, not on update.
   * Useful for fields like 'createdAt' or 'createdBy'.
   */
  protected createOnlyFields?: string[];

  /**
   * Fields that can only be set on update, not on create.
   * Useful for fields like 'updatedAt' or 'version'.
   */
  protected updateOnlyFields?: string[];

  /**
   * Maximum number of items allowed in a single batch.
   * @default 100
   */
  protected maxBatchSize: number = 100;

  /**
   * Whether to continue processing remaining items if one fails.
   * @default false
   */
  protected continueOnError: boolean = false;

  /**
   * Whether to use native database batch upsert (ON CONFLICT DO UPDATE).
   * When enabled, uses a single atomic query for the entire batch.
   *
   * Benefits:
   * - Single database round-trip for all items
   * - Atomic operation prevents race conditions
   * - Significantly better performance for large batches
   *
   * Limitations:
   * - Cannot accurately determine which records were created vs updated
   * - beforeItem/afterItem hooks are not called for individual items
   * - Soft delete handling may require additional logic
   *
   * @default false
   */
  protected useNativeUpsert: boolean = false;

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
   * Returns the upsert keys used to find existing records.
   * Defaults to primary keys if not specified.
   */
  protected getUpsertKeys(): string[] {
    return this.upsertKeys || this._meta.model.primaryKeys;
  }

  /**
   * Returns the Zod schema for a single item in the batch.
   */
  protected getItemSchema(): ZodObject<ZodRawShape> {
    if (this._meta.fields) {
      return this._meta.fields;
    }

    // For upsert, upsert keys are required, other fields optional
    const upsertKeys = this.getUpsertKeys();
    const allFields = getSchemaFields(this._meta.model.schema, []);

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, value] of Object.entries(allFields.shape)) {
      if (upsertKeys.includes(key)) {
        shape[key] = value as z.ZodTypeAny;
      } else {
        shape[key] = (value as z.ZodTypeAny).optional();
      }
    }

    return z.object(shape) as ZodObject<ZodRawShape>;
  }

  /**
   * Returns the Zod schema for request body (array of items).
   */
  protected getBodySchema(): z.ZodArray<ZodObject<ZodRawShape>> {
    return z.array(this.getItemSchema()).max(this.maxBatchSize);
  }

  /**
   * Generates OpenAPI schema from meta configuration.
   */
  getSchema(): OpenAPIRouteSchema {
    const itemResultSchema = z.object({
      data: this._meta.model.schema,
      created: z.boolean(),
      index: z.number(),
    });

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
          description: 'Batch upsert completed',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  items: z.array(itemResultSchema),
                  createdCount: z.number(),
                  updatedCount: z.number(),
                  totalCount: z.number(),
                  errors: z
                    .array(
                      z.object({
                        index: z.number(),
                        error: z.string(),
                      })
                    )
                    .optional(),
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
   * Gets the validated request body (array of items).
   */
  protected async getItems(): Promise<Partial<ModelObject<M['model']>>[]> {
    const { body } = await this.getValidatedData<Partial<ModelObject<M['model']>>[]>();
    return body as Partial<ModelObject<M['model']>>[];
  }

  /**
   * Lifecycle hook: called before processing each item.
   * Override to transform data before saving.
   */
  async beforeItem(
    data: Partial<ModelObject<M['model']>>,
    _index: number,
    _isCreate: boolean,
    _tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after processing each item.
   * Override to transform result before adding to response.
   */
  async afterItem(
    data: ModelObject<M['model']>,
    _index: number,
    _created: boolean,
    _tx?: unknown
  ): Promise<ModelObject<M['model']>> {
    return data;
  }

  /**
   * Lifecycle hook: called before processing the entire batch.
   */
  async beforeBatch(
    items: Partial<ModelObject<M['model']>>[],
    _tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>[]> {
    return items;
  }

  /**
   * Lifecycle hook: called after processing the entire batch.
   */
  async afterBatch(
    result: BatchUpsertResult<ModelObject<M['model']>>,
    _tx?: unknown
  ): Promise<BatchUpsertResult<ModelObject<M['model']>>> {
    return result;
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
   * Performs a single upsert operation.
   */
  protected async upsertOne(
    data: Partial<ModelObject<M['model']>>,
    index: number,
    tx?: unknown
  ): Promise<BatchUpsertItemResult<ModelObject<M['model']>>> {
    const existing = await this.findExisting(data, tx);
    const isCreate = !existing;

    // Apply beforeItem hook
    let processedData = await this.beforeItem(data, index, isCreate, tx);

    let result: ModelObject<M['model']>;

    if (existing) {
      // Filter out create-only fields for update
      if (this.createOnlyFields) {
        for (const field of this.createOnlyFields) {
          delete processedData[field as keyof typeof processedData];
        }
      }
      result = await this.update(existing, processedData, tx);
    } else {
      // Filter out update-only fields for create
      if (this.updateOnlyFields) {
        for (const field of this.updateOnlyFields) {
          delete processedData[field as keyof typeof processedData];
        }
      }
      result = await this.create(processedData, tx);
    }

    // Apply afterItem hook
    result = await this.afterItem(result, index, isCreate, tx);

    return {
      data: result,
      created: isCreate,
      index,
    };
  }

  /**
   * Performs a native database batch upsert operation.
   * Override in ORM-specific subclasses to use native ON CONFLICT DO UPDATE.
   *
   * The default implementation falls back to the item-by-item pattern.
   *
   * @param items The items to upsert
   * @param tx Optional transaction
   * @returns The batch result (created counts may not be accurate with native upsert)
   */
  protected async nativeBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<BatchUpsertResult<ModelObject<M['model']>>> {
    // Default implementation falls back to non-native batch upsert
    // ORM adapters should override this method
    getLogger().warn('Native batch upsert not implemented for this adapter. Falling back to item-by-item pattern.');
    return this.performStandardBatchUpsert(items, tx);
  }

  /**
   * Performs the standard item-by-item batch upsert pattern.
   * This is the non-native fallback implementation.
   */
  protected async performStandardBatchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<BatchUpsertResult<ModelObject<M['model']>>> {
    const results: BatchUpsertItemResult<ModelObject<M['model']>>[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < items.length; i++) {
      try {
        const itemResult = await this.upsertOne(items[i], i, tx);
        results.push(itemResult);

        if (itemResult.created) {
          createdCount++;
        } else {
          updatedCount++;
        }
      } catch (error) {
        if (this.continueOnError) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          throw error;
        }
      }
    }

    const result: BatchUpsertResult<ModelObject<M['model']>> = {
      items: results,
      createdCount,
      updatedCount,
      totalCount: results.length,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Performs the batch upsert operation.
   * Uses native batch upsert when enabled, otherwise processes items one by one.
   */
  async batchUpsert(
    items: Partial<ModelObject<M['model']>>[],
    tx?: unknown
  ): Promise<BatchUpsertResult<ModelObject<M['model']>>> {
    if (this.useNativeUpsert) {
      return this.nativeBatchUpsert(items, tx);
    }
    return this.performStandardBatchUpsert(items, tx);
  }

  /**
   * Main handler for the batch upsert operation.
   */
  async handle(): Promise<Response> {

    let items = await this.getItems();

    // Apply beforeBatch hook
    items = await this.beforeBatch(items);

    // Perform batch upsert
    let result = await this.batchUpsert(items);

    // Apply afterBatch hook
    result = await this.afterBatch(result);

    // Apply computed fields if defined
    if (this._meta.model.computedFields) {
      result.items = await Promise.all(
        result.items.map(async (item) => ({
          ...item,
          data: (await applyComputedFields(
            item.data as Record<string, unknown>,
            this._meta.model.computedFields!
          )) as ModelObject<M['model']>,
        }))
      );
    }

    // Audit logging
    if (this.isAuditEnabled()) {
      const auditLogger = this.getAuditLogger();
      const auditRecords = result.items
        .map((item) => {
          const recordId = this.getRecordId(item.data);
          if (recordId === null) return null;
          return {
            recordId,
            record: item.data as Record<string, unknown>,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (auditRecords.length > 0) {
        this.runAfterResponse(auditLogger.logBatch(
          'batch_upsert',
          this._meta.model.tableName,
          auditRecords,
          this.getAuditUserId()
        ));
      }
    }

    // Apply serializer if defined
    if (this._meta.model.serializer) {
      result.items = result.items.map((item) => ({
        ...item,
        data: this._meta.model.serializer!(item.data) as ModelObject<M['model']>,
      }));
    }

    return this.success(result);
  }
}
