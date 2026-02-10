import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { Env } from 'hono';
import { OpenAPIRoute } from '../core/route';
import type { MetaInput, OpenAPIRouteSchema, NormalizedAuditConfig } from '../core/types';
import { getAuditConfig, getSoftDeleteConfig, type NormalizedSoftDeleteConfig } from '../core/types';
import type { ModelObject } from './types';
import { createAuditLogger, type AuditLogger } from '../core/audit';
import { parseCsv, validateCsvHeaders, type CsvParseOptions } from '../utils/csv';
import { InputValidationException } from '../core/exceptions';

// ============================================================================
// Import Types
// ============================================================================

/**
 * Import mode: create only or upsert (create or update).
 */
export type ImportMode = 'create' | 'upsert';

/**
 * Status of a single row import.
 */
export type ImportRowStatus = 'created' | 'updated' | 'skipped' | 'failed';

/**
 * Result for a single imported row.
 */
export interface ImportRowResult<T = Record<string, unknown>> {
  /** 1-indexed row number from the import file. */
  rowNumber: number;
  /** Status of the import operation. */
  status: ImportRowStatus;
  /** The imported/updated record (if successful). */
  data?: T;
  /** Error message (if failed). */
  error?: string;
  /** Validation errors (if failed due to validation). */
  validationErrors?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Summary of the import operation.
 */
export interface ImportSummary {
  /** Total number of rows processed. */
  total: number;
  /** Number of records created. */
  created: number;
  /** Number of records updated (upsert mode). */
  updated: number;
  /** Number of rows skipped. */
  skipped: number;
  /** Number of rows that failed. */
  failed: number;
}

/**
 * Result of the import operation.
 */
export interface ImportResult<T = Record<string, unknown>> {
  /** Summary statistics. */
  summary: ImportSummary;
  /** Detailed results per row. */
  results: ImportRowResult<T>[];
}

/**
 * Options for the import operation.
 */
export interface ImportOptions {
  /** Import mode: create only or upsert. */
  mode: ImportMode;
  /** Whether to skip rows that fail validation. */
  skipInvalidRows: boolean;
  /** Whether to stop on first error. */
  stopOnError: boolean;
}

// ============================================================================
// ImportEndpoint Base Class
// ============================================================================

/**
 * Base endpoint for importing resources from CSV or JSON.
 * Supports bulk create and upsert operations with detailed error reporting.
 *
 * Features:
 * - JSON, CSV, and multipart/form-data content types
 * - Create mode (fails on duplicates) and Upsert mode
 * - Per-row validation with detailed error messages
 * - Partial success support (207 Multi-Status)
 * - Configurable upsert keys and immutable fields
 * - Edge runtime compatible (Web APIs only)
 *
 * @example
 * ```ts
 * class UserImport extends MemoryImportEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Import users' };
 *
 *   protected maxBatchSize = 1000;
 *   protected upsertKeys = ['email'];  // Match by email for upsert
 *   protected immutableFields = ['id', 'createdAt'];
 * }
 * ```
 *
 * API Usage:
 * - `POST /users/import` - Import as create (fails on duplicates)
 * - `POST /users/import?mode=upsert` - Create or update by upsertKeys
 * - Content-Type: `application/json`, `text/csv`, or `multipart/form-data`
 */
export abstract class ImportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends OpenAPIRoute<E> {
  abstract _meta: M;

  /** Maximum number of records per import request. */
  protected maxBatchSize: number = 1000;

  /** Whether to stop on first error. */
  protected stopOnError: boolean = false;

  /** Whether to skip rows that fail validation. */
  protected skipInvalidRows: boolean = true;

  /** Default import mode. */
  protected defaultMode: ImportMode = 'create';

  /** Keys used to find existing records for upsert. Defaults to primaryKeys. */
  protected upsertKeys?: string[];

  /** Fields that cannot be modified during upsert (update). */
  protected immutableFields: string[] = [];

  /** CSV parsing options. */
  protected csvOptions: Partial<CsvParseOptions> = {};

  /** Fields that are optional during import (won't cause validation errors if missing). */
  protected optionalImportFields: string[] = [];

  // Audit logging
  private _auditLogger?: AuditLogger;

  /**
   * Get the soft delete configuration for this model.
   */
  protected getSoftDeleteConfig(): NormalizedSoftDeleteConfig {
    return getSoftDeleteConfig(this._meta.model.softDelete);
  }

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
   * Check if audit logging is enabled.
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
    const ctx = this.context as unknown as { var?: Record<string, unknown> };
    return ctx?.var?.userId as string | undefined;
  }

  /**
   * Gets the upsert keys for matching existing records.
   */
  protected getUpsertKeys(): string[] {
    return this.upsertKeys || this._meta.model.primaryKeys;
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
   * Returns the schema for import request body.
   */
  protected getImportSchema(): ZodObject<ZodRawShape> {
    const baseSchema = this._meta.fields || this._meta.model.schema;

    // Make all fields optional for partial validation
    // The actual validation will be done per-row with detailed errors
    return z.object({
      items: z.array(baseSchema.partial()).min(1).max(this.maxBatchSize),
    }) as unknown as ZodObject<ZodRawShape>;
  }

  /**
   * Generates OpenAPI schema for the import endpoint.
   * Note: Body validation is handled manually in parseImportData() to support
   * multiple content types (JSON, CSV, multipart/form-data).
   */
  getSchema(): OpenAPIRouteSchema {
    return {
      ...this.schema,
      request: {
        query: z.object({
          mode: z.enum(['create', 'upsert']).optional().describe('Import mode'),
          skipInvalid: z.enum(['true', 'false']).optional().describe('Skip invalid rows'),
          stopOnError: z.enum(['true', 'false']).optional().describe('Stop on first error'),
        }),
        // Body validation is done manually to support multiple content types
      },
      responses: {
        200: {
          description: 'Import completed successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  summary: z.object({
                    total: z.number(),
                    created: z.number(),
                    updated: z.number(),
                    skipped: z.number(),
                    failed: z.number(),
                  }),
                  results: z.array(z.object({
                    rowNumber: z.number(),
                    status: z.enum(['created', 'updated', 'skipped', 'failed']),
                    data: z.any().optional(),
                    error: z.string().optional(),
                    validationErrors: z.array(z.object({
                      path: z.string(),
                      message: z.string(),
                    })).optional(),
                  })),
                }),
              }),
            },
          },
        },
        207: {
          description: 'Import completed with partial failures',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  summary: z.object({
                    total: z.number(),
                    created: z.number(),
                    updated: z.number(),
                    skipped: z.number(),
                    failed: z.number(),
                  }),
                  results: z.array(z.object({
                    rowNumber: z.number(),
                    status: z.enum(['created', 'updated', 'skipped', 'failed']),
                    data: z.any().optional(),
                    error: z.string().optional(),
                    validationErrors: z.array(z.object({
                      path: z.string(),
                      message: z.string(),
                    })).optional(),
                  })),
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
                  details: z.any().optional(),
                }),
              }),
            },
          },
        },
      },
    };
  }

  /**
   * Parses import options from query parameters.
   */
  protected async getImportOptions(): Promise<ImportOptions> {
    const { query } = await this.getValidatedData();
    return {
      mode: (query?.mode as ImportMode) || this.defaultMode,
      skipInvalidRows: query?.skipInvalid === 'true' ? true : this.skipInvalidRows,
      stopOnError: query?.stopOnError === 'true' ? true : this.stopOnError,
    };
  }

  /**
   * Parses the import data from the request body.
   * Handles JSON, CSV, and multipart/form-data content types.
   */
  protected async parseImportData(): Promise<Array<Partial<ModelObject<M['model']>>>> {
    const ctx = this.context;
    if (!ctx) {
      throw new InputValidationException('No request available');
    }

    const contentType = ctx.req.header('content-type') || '';

    // Handle JSON
    if (contentType.includes('application/json')) {
      const body = await ctx.req.json() as { items?: unknown[] };

      if (!body) {
        throw new InputValidationException('Request body is empty');
      }

      if (!body.items || !Array.isArray(body.items)) {
        throw new InputValidationException('Request body must contain an "items" array');
      }
      if (body.items.length > this.maxBatchSize) {
        throw new InputValidationException(`Maximum ${this.maxBatchSize} items allowed per import`);
      }
      return body.items as Array<Partial<ModelObject<M['model']>>>;
    }

    // Handle CSV - body is not consumed by OpenAPI validator for text/csv
    if (contentType.includes('text/csv')) {
      const csvContent = await ctx.req.text();
      return this.parseCsvData(csvContent);
    }

    // Handle multipart/form-data - body is not consumed by OpenAPI validator
    if (contentType.includes('multipart/form-data')) {
      const formData = await ctx.req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        throw new InputValidationException('No file provided in form data');
      }

      const content = await file.text();
      const filename = file.name.toLowerCase();

      if (filename.endsWith('.json')) {
        const body = JSON.parse(content) as { items?: unknown[] } | unknown[];
        const items = Array.isArray(body) ? body : body.items;
        if (!items || !Array.isArray(items)) {
          throw new InputValidationException('JSON file must contain an array or an object with "items" array');
        }
        if (items.length > this.maxBatchSize) {
          throw new InputValidationException(`Maximum ${this.maxBatchSize} items allowed per import`);
        }
        return items as Array<Partial<ModelObject<M['model']>>>;
      }

      if (filename.endsWith('.csv')) {
        return this.parseCsvData(content);
      }

      // Try to detect format from content
      const trimmed = content.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const body = JSON.parse(content) as { items?: unknown[] } | unknown[];
        const items = Array.isArray(body) ? body : body.items;
        if (!items || !Array.isArray(items)) {
          throw new InputValidationException('JSON file must contain an array or an object with "items" array');
        }
        return items as Array<Partial<ModelObject<M['model']>>>;
      }

      // Default to CSV
      return this.parseCsvData(content);
    }

    throw new InputValidationException(
      'Unsupported content type. Use application/json, text/csv, or multipart/form-data'
    );
  }

  /**
   * Parses CSV content into import data.
   */
  protected parseCsvData(content: string): Array<Partial<ModelObject<M['model']>>> {
    const result = parseCsv(content, this.csvOptions);

    if (result.errors.length > 0) {
      throw new InputValidationException(
        `CSV parsing errors: ${result.errors.map(e => `Row ${e.row}: ${e.message}`).join('; ')}`
      );
    }

    if (result.data.length === 0) {
      throw new InputValidationException('CSV file is empty');
    }

    if (result.data.length > this.maxBatchSize) {
      throw new InputValidationException(`Maximum ${this.maxBatchSize} items allowed per import`);
    }

    // Validate headers against schema
    const schema = this._meta.fields || this._meta.model.schema;
    const validation = validateCsvHeaders(result.headers, schema, {
      allowUnknownFields: true,
      optionalFields: this.optionalImportFields,
    });

    if (!validation.valid && validation.missingFields.length > 0) {
      throw new InputValidationException(
        `Missing required fields in CSV: ${validation.missingFields.join(', ')}`
      );
    }

    return result.data as Array<Partial<ModelObject<M['model']>>>;
  }

  /**
   * Validates a single row against the schema.
   */
  protected validateRow(
    data: Partial<ModelObject<M['model']>>,
    _rowNumber: number
  ): { valid: boolean; errors?: Array<{ path: string; message: string }> } {
    const schema = this._meta.fields || this._meta.model.schema;

    // Make primary keys optional for create (they can be auto-generated)
    const primaryKeys = this._meta.model.primaryKeys;
    const partialKeys: Record<string, true> = {};
    for (const pk of primaryKeys) {
      partialKeys[pk] = true;
    }

    // Also make optional import fields partial
    for (const field of this.optionalImportFields) {
      partialKeys[field] = true;
    }

    const validationSchema = schema.partial(partialKeys);

    try {
      validationSchema.parse(data);
      return { valid: true };
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return { valid: false, errors };
      }
      return {
        valid: false,
        errors: [{ path: '', message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  /**
   * Removes immutable fields from update data.
   */
  protected removeImmutableFields(
    data: Partial<ModelObject<M['model']>>
  ): Partial<ModelObject<M['model']>> {
    if (this.immutableFields.length === 0) {
      return data;
    }

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!this.immutableFields.includes(key)) {
        filtered[key] = value;
      }
    }
    return filtered as Partial<ModelObject<M['model']>>;
  }

  /**
   * Lifecycle hook: called before each row is processed.
   * Override to transform data before import.
   */
  async before(
    data: Partial<ModelObject<M['model']>>,
    _rowNumber: number,
    _mode: ImportMode,
    _tx?: unknown
  ): Promise<Partial<ModelObject<M['model']>>> {
    return data;
  }

  /**
   * Lifecycle hook: called after each row is processed.
   * Override to perform post-processing.
   */
  async after(
    result: ImportRowResult<ModelObject<M['model']>>,
    _rowNumber: number,
    _mode: ImportMode,
    _tx?: unknown
  ): Promise<ImportRowResult<ModelObject<M['model']>>> {
    return result;
  }

  /**
   * Finds an existing record for upsert mode.
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
   * Processes a single row for import.
   */
  protected async processRow(
    data: Partial<ModelObject<M['model']>>,
    rowNumber: number,
    options: ImportOptions,
    tx?: unknown
  ): Promise<ImportRowResult<ModelObject<M['model']>>> {
    // Validate the row
    const validation = this.validateRow(data, rowNumber);
    if (!validation.valid) {
      if (options.skipInvalidRows) {
        return {
          rowNumber,
          status: 'skipped',
          error: 'Validation failed',
          validationErrors: validation.errors,
        };
      }
      return {
        rowNumber,
        status: 'failed',
        error: 'Validation failed',
        validationErrors: validation.errors,
      };
    }

    try {
      // Apply before hook
      let processedData = await this.before(data, rowNumber, options.mode, tx);

      if (options.mode === 'upsert') {
        // Check for existing record
        const existing = await this.findExisting(processedData, tx);

        if (existing) {
          // Update existing record
          const updateData = this.removeImmutableFields(processedData);
          const updated = await this.update(existing, updateData, tx);
          return {
            rowNumber,
            status: 'updated',
            data: updated,
          };
        }
      } else {
        // Create mode: check for duplicates
        const existing = await this.findExisting(processedData, tx);
        if (existing) {
          if (options.skipInvalidRows) {
            return {
              rowNumber,
              status: 'skipped',
              error: 'Record already exists',
            };
          }
          return {
            rowNumber,
            status: 'failed',
            error: 'Record already exists (duplicate key)',
          };
        }
      }

      // Create new record
      const created = await this.create(processedData, tx);
      return {
        rowNumber,
        status: 'created',
        data: created,
      };
    } catch (err) {
      return {
        rowNumber,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Main handler for the import operation.
   */
  async handle(): Promise<Response> {

    const options = await this.getImportOptions();
    const items = await this.parseImportData();

    const summary: ImportSummary = {
      total: items.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    const results: ImportRowResult<ModelObject<M['model']>>[] = [];

    // Process each row
    for (let i = 0; i < items.length; i++) {
      const rowNumber = i + 1;
      const data = items[i];

      let result = await this.processRow(data, rowNumber, options);

      // Apply after hook
      result = await this.after(result, rowNumber, options.mode);

      results.push(result);

      // Update summary
      switch (result.status) {
        case 'created':
          summary.created++;
          break;
        case 'updated':
          summary.updated++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
        case 'failed':
          summary.failed++;
          break;
      }

      // Stop on error if configured
      if (options.stopOnError && result.status === 'failed') {
        break;
      }
    }

    // Audit logging
    if (this.isAuditEnabled()) {
      const auditLogger = this.getAuditLogger();
      const successfulResults = results.filter(
        (r) => r.status === 'created' || r.status === 'updated'
      );

      if (successfulResults.length > 0) {
        const auditRecords = successfulResults
          .map((r) => {
            if (!r.data) return null;
            const recordId = this.getRecordId(r.data);
            if (recordId === null) return null;
            return {
              recordId,
              record: r.data as Record<string, unknown>,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (auditRecords.length > 0) {
          this.runAfterResponse(auditLogger.logBatch(
            options.mode === 'upsert' ? 'batch_upsert' : 'batch_create',
            this._meta.model.tableName,
            auditRecords,
            this.getAuditUserId()
          ));
        }
      }
    }

    const importResult: ImportResult<ModelObject<M['model']>> = {
      summary,
      results,
    };

    // Return 207 Multi-Status if there were partial failures
    const status = summary.failed > 0 && summary.failed < summary.total ? 207 : 200;

    return this.json({ success: true, result: importResult }, status);
  }
}
