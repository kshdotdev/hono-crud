import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { getManagedInputExclusions, rethrowAsConstraintError } from '../core/managed-fields';
import type { HookMode, MetaInput, OpenAPIRouteSchema } from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema } from './responses';
import { type ModelObject, getSchemaFields } from './types';

/**
 * Base endpoint for batch creating resources.
 * Extend this class and implement the `batchCreate` method for your ORM.
 *
 * Accepts an array of objects and creates them all, returning the created records.
 */
export abstract class BatchCreateEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  /** Maximum number of records that can be created in a single request */
  protected maxBatchSize = 100;

  /** Whether to stop on first error or continue with remaining items */
  protected stopOnError = true;

  /** Hook execution mode */
  protected beforeHookMode: HookMode = 'sequential';
  protected afterHookMode: HookMode = 'sequential';

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
   * Gets the record ID from a created record.
   */

  /**
   * Returns the request body schema for batch creation.
   *
   * The per-item schema is the model schema minus the engine-managed /
   * server-owned write fields — primary keys (per the `Model.id`
   * strategy) and any configured `Model.timestamps` — exactly as the
   * single-create derivation does. This keeps batch-create consistent
   * with single-create: the engine generates the id and stamps the
   * timestamps (`applyManagedInsertFields`), so a caller is never forced
   * to send placeholders. A consumer-supplied per-endpoint body schema
   * (`this._meta.fields`) still wins and is never rewritten.
   */
  protected getBodySchema(): ZodObject<ZodRawShape> {
    const itemSchema = this._meta.fields
      ? this._meta.fields
      : getSchemaFields(this.getModelSchema(), getManagedInputExclusions(this._meta.model));

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
                  created: z.array(this.getModelSchema()),
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
                  created: z.array(this.getModelSchema()),
                  count: z.number(),
                  errors: z
                    .array(
                      z.object({
                        index: z.number(),
                        error: z.string(),
                      }),
                    )
                    .optional(),
                }),
              }),
            },
          },
        },
        400: errorResponseSchema('Validation error'),
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
    _index: number,
    _tx?: unknown,
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after each item is created.
   * Override to transform result before returning.
   */
  async after(
    data: ModelObject<M['model']>,
    _index: number,
    _tx?: unknown,
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
    tx?: unknown,
  ): Promise<ModelObject<M['model']>[]>;

  /**
   * Main handler for the batch create operation.
   */
  async handle(): Promise<Response> {
    const items = await this.getItems();
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

    // Create all items. Any UNIQUE-constraint violation thrown by the
    // underlying driver (e.g. a duplicate natural key in the batch) is
    // mapped to the engine's standard 409 envelope — `batchCreate`
    // typically runs as a single bulk insert so a single colliding item
    // aborts the call, which would otherwise bubble up as a plaintext
    // 500. Routed through the centralised mapper so the rule is never
    // duplicated per endpoint.
    const created = await this.batchCreate(processedItems).catch(rethrowAsConstraintError);

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
        this.runAfterResponse(
          auditLogger.logBatch(
            'batch_create',
            this._meta.model.tableName,
            auditRecords,
            this.getAuditUserId(),
          ),
        );
      }
    }

    // computed fields → serializer → profile → transform
    const transformed = await this.finalizeArray(results);

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
