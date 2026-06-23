import type { Env } from 'hono';
import { type ZodObject, type ZodRawShape, z } from 'zod';
import { getManagedInputExclusions } from '../core/managed-fields';
import type { HookMode, ListFilters, MetaInput, OpenAPIRouteSchema } from '../core/types';
import { CrudEndpoint } from './base';
import { errorResponseSchema, mergeRouteSchema } from './responses';
import type { ListFilterParseOptions, ModelObject } from './types';
import { getSchemaFields, parseListFilters } from './types';

/**
 * Result of a bulk patch operation.
 */
export interface BulkPatchResult<T = unknown> {
  /** Number of records that matched the filter */
  matched: number;
  /** Number of records actually updated */
  updated: number;
  /** Whether this was a dry run (no actual updates) */
  dryRun: boolean;
  /** Updated records (only if not dry run and returnRecords is true) */
  records?: T[];
}

/**
 * Base endpoint for bulk patching resources matching a filter.
 *
 * `PATCH /resource?role=inactive` → update all matching records.
 *
 * Supports dry-run mode via `?dryRun=true` query parameter.
 * Requires `X-Confirm-Bulk` header when affecting more than `confirmThreshold` records.
 */
export abstract class BulkPatchEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends CrudEndpoint<E, M> {
  /** Maximum number of records that can be updated in a single bulk operation */
  protected maxBulkSize = 1000;

  /** Require X-Confirm-Bulk header when this many or more records match */
  protected confirmThreshold = 100;

  /** Whether to return updated records in the response */
  protected returnRecords = false;

  /** Hook execution mode */
  protected hookMode: HookMode = 'parallel';

  /** Filter fields allowed in query params */
  protected filterFields?: string[];

  /**
   * Returns the Zod schema validating the patch body. Defaults to the model
   * schema minus engine-managed fields (primary keys + managed timestamps),
   * all fields optional — the same exclusion set the Update endpoint uses.
   * Override to narrow the patchable surface further.
   */
  protected getUpdateSchema(): ZodObject<ZodRawShape> {
    const excludeFields = getManagedInputExclusions(this._meta.model);
    return getSchemaFields(
      this.getModelSchema(),
      excludeFields,
    ).partial() as ZodObject<ZodRawShape>;
  }

  /** Count records matching filters (for dry run and threshold check) */
  protected abstract countMatching(filters: ListFilters): Promise<number>;

  /** Apply patch to all matching records */
  protected abstract applyPatch(
    data: Partial<ModelObject<M['model']>>,
    filters: ListFilters,
  ): Promise<{ updated: number; records?: ModelObject<M['model']>[] }>;

  /** Before hook: called before the bulk patch is applied */
  protected async beforeBulkPatch?(
    data: Partial<ModelObject<M['model']>>,
    filters: ListFilters,
    matchedCount: number,
  ): Promise<Partial<ModelObject<M['model']>>>;

  /** After hook: called after the bulk patch is applied */
  protected async afterBulkPatch?(result: BulkPatchResult<ModelObject<M['model']>>): Promise<void>;

  getSchema(): OpenAPIRouteSchema {
    const updateSchema = this.getUpdateSchema();

    return mergeRouteSchema(
      {
        request: {
          body: {
            content: {
              'application/json': {
                schema: updateSchema.partial(),
              },
            },
          },
          query: z
            .object({
              dryRun: z.string().optional(),
            })
            .passthrough(),
        },
        responses: {
          '200': {
            description: 'Bulk patch result',
            content: {
              'application/json': {
                schema: z.object({
                  success: z.boolean(),
                  matched: z.number(),
                  updated: z.number(),
                  dryRun: z.boolean(),
                }),
              },
            },
          },
          '400': errorResponseSchema(
            'Bulk patch rejected (empty body, size limit, or missing confirmation)',
          ),
        },
      },
      this.schema,
    );
  }

  async handle(): Promise<Response> {
    const ctx = this.getContext();
    const data = await this.getValidatedData<Partial<ModelObject<M['model']>>>();
    const body = data.body;

    if (!body || Object.keys(body).length === 0) {
      return this.error(
        'Request body is required with at least one field to update',
        'EMPTY_BODY',
        400,
      );
    }

    // Parse dry run flag
    const dryRunParam = ctx.req.query('dryRun');
    const dryRun = dryRunParam === 'true' || dryRunParam === '1';

    // Parse filters from query params
    const filters = parseListFilters(
      ctx.req.query() as Record<string, string>,
      {
        filterFields: this.filterFields,
        defaultPerPage: this.maxBulkSize,
        maxPerPage: this.maxBulkSize,
      } as ListFilterParseOptions,
    );

    // Constrain the matched set to the caller's tenant BEFORE counting or
    // patching — both countMatching and applyPatch receive these filters, so a
    // bulk patch can never count, dry-run, or mutate another tenant's rows.
    this.applyTenantScope(filters);

    // Count matching records
    const matchedCount = await this.countMatching(filters);

    if (matchedCount === 0) {
      return this.json({
        success: true,
        matched: 0,
        updated: 0,
        dryRun,
      });
    }

    // Check bulk size
    if (matchedCount > this.maxBulkSize) {
      return this.error(
        `Bulk patch affects ${matchedCount} records, exceeding the maximum of ${this.maxBulkSize}. Use more specific filters.`,
        'BULK_TOO_LARGE',
        400,
      );
    }

    // Check confirmation header for large operations
    if (matchedCount >= this.confirmThreshold) {
      const confirmHeader = ctx.req.header('X-Confirm-Bulk');
      if (confirmHeader !== 'true') {
        return this.error(
          `This operation will affect ${matchedCount} records. Set X-Confirm-Bulk: true header to confirm.`,
          'CONFIRMATION_REQUIRED',
          400,
        );
      }
    }

    // Dry run — just return count
    if (dryRun) {
      return this.json({
        success: true,
        matched: matchedCount,
        updated: 0,
        dryRun: true,
      });
    }

    // Apply before hook
    let patchData: Partial<ModelObject<M['model']>> = body;
    if (this.beforeBulkPatch) {
      patchData = await this.beforeBulkPatch(patchData, filters, matchedCount);
    }

    // Apply the patch
    const result = await this.applyPatch(patchData, filters);

    const bulkResult: BulkPatchResult<ModelObject<M['model']>> = {
      matched: matchedCount,
      updated: result.updated,
      dryRun: false,
      records: this.returnRecords ? result.records : undefined,
    };

    // Apply after hook
    if (this.afterBulkPatch) {
      await this.afterBulkPatch(bulkResult);
    }

    return this.json({
      success: true,
      matched: bulkResult.matched,
      updated: bulkResult.updated,
      dryRun: false,
      ...(this.returnRecords && bulkResult.records ? { records: bulkResult.records } : {}),
    });
  }
}
