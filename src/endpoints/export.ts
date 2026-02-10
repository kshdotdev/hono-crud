import { z } from 'zod';
import type { Env } from 'hono';
import { stream } from 'hono/streaming';
import { ListEndpoint } from './list';
import type { MetaInput, OpenAPIRouteSchema, ListFilters } from '../core/types';
import type { ModelObject } from './types';
import {
  generateCsv,
  createCsvStream,
  type CsvGenerateOptions,
} from '../utils/csv';

// ============================================================================
// Export Types
// ============================================================================

/**
 * Supported export formats.
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Options for the export operation.
 */
export interface ExportOptions {
  /** Export format (json or csv). */
  format: ExportFormat;
  /** Fields to include in the export. */
  fields?: string[];
  /** Whether to stream the response (for large exports). */
  stream?: boolean;
}

/**
 * Result of the export operation for JSON format.
 */
export interface ExportResult<T> {
  /** Exported records. */
  data: T[];
  /** Total number of records exported. */
  count: number;
  /** Export format used. */
  format: ExportFormat;
  /** Timestamp of the export. */
  exportedAt: string;
}

// ============================================================================
// ExportEndpoint Base Class
// ============================================================================

/**
 * Base endpoint for exporting resources in CSV or JSON format.
 * Extends ListEndpoint to leverage existing filtering, sorting, pagination, and field selection.
 *
 * Features:
 * - CSV and JSON export formats
 * - Streaming support for large exports via Web ReadableStream
 * - Uses all ListEndpoint features (filters, sort, field selection)
 * - Configurable max records and excluded fields
 * - Edge runtime compatible (Web APIs only)
 *
 * @example
 * ```ts
 * class UserExport extends MemoryExportEndpoint<Env, typeof userMeta> {
 *   _meta = userMeta;
 *   schema = { tags: ['Users'], summary: 'Export users' };
 *
 *   protected maxExportRecords = 10000;
 *   protected excludedExportFields = ['password', 'passwordHash'];
 *   protected filterFields = ['status', 'role'];
 * }
 * ```
 *
 * API Usage:
 * - `GET /users/export` - Export as JSON (default)
 * - `GET /users/export?format=csv` - Export as CSV
 * - `GET /users/export?format=csv&status=active` - Export with filters
 * - `GET /users/export?format=json&fields=id,name,email` - Export with field selection
 * - `GET /users/export?format=csv&stream=true` - Stream large exports
 */
export abstract class ExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
  /** Maximum number of records that can be exported in a single request. */
  protected maxExportRecords: number = 10000;

  /** Whether to enable streaming for large exports. */
  protected enableStreaming: boolean = true;

  /** Fields to exclude from the export. */
  protected excludedExportFields: string[] = [];

  /** Default export format. */
  protected defaultFormat: ExportFormat = 'json';

  /** CSV generation options. */
  protected csvOptions: Partial<CsvGenerateOptions> = {};

  /** Custom filename for the export (without extension). */
  protected exportFilename?: string;

  /**
   * Returns the query parameter schema for export.
   * Extends the ListEndpoint schema with format and stream parameters.
   */
  protected getExportQuerySchema() {
    const baseSchema = this.getQuerySchema();
    return baseSchema.extend({
      format: z.enum(['json', 'csv']).optional().describe('Export format'),
      stream: z.enum(['true', 'false']).optional().describe('Enable streaming for large exports'),
    });
  }

  /**
   * Generates OpenAPI schema for the export endpoint.
   */
  getSchema(): OpenAPIRouteSchema {
    return {
      ...this.schema,
      request: {
        query: this.getExportQuerySchema(),
      },
      responses: {
        200: {
          description: 'Export successful',
          content: {
            'application/json': {
              schema: z.object({
                success: z.literal(true),
                result: z.object({
                  data: z.array(this._meta.model.schema),
                  count: z.number(),
                  format: z.enum(['json', 'csv']),
                  exportedAt: z.string(),
                }),
              }),
            },
            'text/csv': {
              schema: z.string(),
            },
          },
        },
      },
    };
  }

  /**
   * Parses export options from query parameters.
   */
  protected async getExportOptions(): Promise<ExportOptions> {
    const { query } = await this.getValidatedData();
    const format = (query?.format as ExportFormat) || this.defaultFormat;
    const stream = query?.stream === 'true' && this.enableStreaming;

    return {
      format,
      stream,
      fields: query?.fields ? String(query.fields).split(',') : undefined,
    };
  }

  /**
   * Gets the filename for the export.
   */
  protected getExportFilename(format: ExportFormat): string {
    const baseName = this.exportFilename || this._meta.model.tableName;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${baseName}-export-${timestamp}.${format}`;
  }

  /**
   * Prepares records for export by applying field exclusions.
   */
  protected prepareRecordsForExport(
    records: ModelObject<M['model']>[]
  ): Record<string, unknown>[] {
    if (this.excludedExportFields.length === 0) {
      return records as Record<string, unknown>[];
    }

    return records.map((record) => {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
        if (!this.excludedExportFields.includes(key)) {
          filtered[key] = value;
        }
      }
      return filtered;
    });
  }

  /**
   * Exports records as JSON format.
   */
  protected exportAsJson(
    records: Record<string, unknown>[],
    format: ExportFormat
  ): Response {
    const result: ExportResult<Record<string, unknown>> = {
      data: records,
      count: records.length,
      format,
      exportedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify({ success: true, result }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${this.getExportFilename(format)}"`,
      },
    });
  }

  /**
   * Exports records as CSV format (non-streaming).
   */
  protected exportAsCsv(
    records: Record<string, unknown>[],
    format: ExportFormat
  ): Response {
    const csv = generateCsv(records, {
      ...this.csvOptions,
      excludeFields: this.excludedExportFields,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${this.getExportFilename(format)}"`,
      },
    });
  }

  /**
   * Exports records as CSV format with streaming using Hono's stream helper.
   * Provides better memory efficiency for large exports.
   */
  protected exportAsCsvStream(
    records: Record<string, unknown>[],
    format: ExportFormat
  ): Response {
    const ctx = this.getContext();
    const filename = this.getExportFilename(format);
    const csvOptions = {
      ...this.csvOptions,
      excludeFields: this.excludedExportFields,
    };

    // Use Hono's stream helper for better integration
    return stream(ctx, async (streamWriter) => {
      // Set headers before writing
      ctx.header('Content-Type', 'text/csv; charset=utf-8');
      ctx.header('Content-Disposition', `attachment; filename="${filename}"`);

      // Generate CSV header
      if (records.length > 0) {
        const firstRecord = records[0];
        const fields = Object.keys(firstRecord).filter(
          (key) => !csvOptions.excludeFields?.includes(key)
        );

        // Write header row
        const headerRow = fields.map((field) => this.escapeCsvField(String(field))).join(',') + '\n';
        await streamWriter.write(headerRow);

        // Write data rows in batches for memory efficiency
        const batchSize = 100;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          for (const record of batch) {
            const row = fields.map((field) => {
              const value = record[field];
              return this.escapeCsvField(this.formatCsvValue(value));
            }).join(',') + '\n';
            await streamWriter.write(row);
          }
        }
      }
    });
  }

  /**
   * Escapes a CSV field value for safe output.
   */
  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Formats a value for CSV output.
   */
  private formatCsvValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Legacy streaming method using Web ReadableStream.
   * Kept for backwards compatibility.
   */
  protected exportAsCsvStreamLegacy(
    records: Record<string, unknown>[],
    format: ExportFormat
  ): Response {
    const csvStream = createCsvStream(records, {
      ...this.csvOptions,
      excludeFields: this.excludedExportFields,
    });

    return new Response(csvStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${this.getExportFilename(format)}"`,
        'Transfer-Encoding': 'chunked',
      },
    });
  }

  /**
   * Lifecycle hook: called after records are fetched but before export.
   * Override to transform or filter records before export.
   */
  async beforeExport(
    records: ModelObject<M['model']>[]
  ): Promise<ModelObject<M['model']>[]> {
    return records;
  }

  /**
   * Fetches all records for export.
   * Overrides pagination to fetch up to maxExportRecords.
   */
  protected async fetchAllForExport(
    filters: ListFilters
  ): Promise<ModelObject<M['model']>[]> {
    // Override pagination to fetch all records up to the limit
    const exportFilters: ListFilters = {
      ...filters,
      options: {
        ...filters.options,
        page: 1,
        per_page: this.maxExportRecords,
      },
    };

    const result = await this.list(exportFilters);
    return result.result;
  }

  /**
   * Main handler for the export operation.
   */
  async handle(): Promise<Response> {

    const exportOptions = await this.getExportOptions();
    const filters = await this.getFilters();

    // Fetch all records for export
    let records = await this.fetchAllForExport(filters);

    // Apply after hook (from ListEndpoint)
    records = await this.after(records);

    // Apply beforeExport hook
    records = await this.beforeExport(records);

    // Prepare records (apply field exclusions)
    const preparedRecords = this.prepareRecordsForExport(records);

    // Export based on format
    if (exportOptions.format === 'csv') {
      if (exportOptions.stream && preparedRecords.length > 1000) {
        return this.exportAsCsvStream(preparedRecords, exportOptions.format);
      }
      return this.exportAsCsv(preparedRecords, exportOptions.format);
    }

    // Default: JSON
    return this.exportAsJson(preparedRecords, exportOptions.format);
  }
}
