import { z } from 'zod';
import type { Env } from 'hono';
import { stream } from 'hono/streaming';
import { ListEndpoint } from './list';
import type { MetaInput, OpenAPIRouteSchema, ListFilters } from '../core/types';
import type { ModelObject } from './types';
import {
  generateCsv,
  escapeCsvValue,
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
 * Extends ListEndpoint to leverage filtering, sorting, pagination, and field selection.
 * Edge-runtime compatible (Web APIs only); CSV streaming uses Web `ReadableStream`.
 *
 * Query params: `format=json|csv`, `stream=true|false` (see `getExportQuerySchema`).
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
 */
export abstract class ExportEndpoint<
  E extends Env = Env,
  M extends MetaInput = MetaInput,
> extends ListEndpoint<E, M> {
  /** Maximum number of records that can be exported in a single request. */
  protected maxExportRecords: number = 10000;

  /** Whether to enable streaming for large exports. */
  protected enableStreaming: boolean = true;

  /** Page size for paginated streaming export. @default 500 */
  protected streamPageSize: number = 500;

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
                  data: z.array(this.getModelSchema()),
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
    const rawName = this.exportFilename || this._meta.model.tableName;
    // Sanitize filename to prevent header injection
    const baseName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
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
    const csvOptions = this.csvOptions;
    const excludedFields = this.excludedExportFields;

    return stream(ctx, async (streamWriter) => {
      ctx.header('Content-Type', 'text/csv; charset=utf-8');
      ctx.header('Content-Disposition', `attachment; filename="${filename}"`);

      if (records.length === 0) return;

      const fields = Object.keys(records[0]).filter((key) => !excludedFields.includes(key));
      const headerRow = fields.map((field) => escapeCsvValue(field, csvOptions)).join(',') + '\n';
      await streamWriter.write(headerRow);

      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        for (const record of records.slice(i, i + batchSize)) {
          const row = fields.map((field) => escapeCsvValue(record[field], csvOptions)).join(',') + '\n';
          await streamWriter.write(row);
        }
      }
    });
  }

  /**
   * Paginated streaming export using ReadableStream.
   * Fetches records page-by-page and encodes each chunk as CSV rows,
   * avoiding loading all records into memory at once.
   */
  protected exportAsCsvStreamPaginated(
    filters: ListFilters,
    format: ExportFormat
  ): Response {
    const filename = this.getExportFilename(format);
    const pageSize = this.streamPageSize;
    const maxRecords = Math.min(this.maxExportRecords, 100_000);
    const excludedFields = this.excludedExportFields;
    const csvOptions = this.csvOptions;
    let headerFields: string[] | null = null;

    const readable = new ReadableStream({
      start: async (controller) => {
        const encoder = new TextEncoder();
        let page = 1;
        let exported = 0;

        try {
          while (exported < maxRecords) {
            const pageFilters: ListFilters = {
              ...filters,
              options: { ...filters.options, page, per_page: pageSize },
            };

            const result = await this.list(pageFilters);
            let records = result.result;

            if (records.length === 0) break;
            if (records.length > maxRecords - exported) {
              records = records.slice(0, maxRecords - exported);
            }

            records = await this.after(records);
            records = await this.beforeExport(records);
            const prepared = this.prepareRecordsForExport(records);

            if (!headerFields && prepared.length > 0) {
              headerFields = Object.keys(prepared[0]).filter((k) => !excludedFields.includes(k));
              const headerRow = headerFields.map((field) => escapeCsvValue(field, csvOptions)).join(',') + '\n';
              controller.enqueue(encoder.encode(headerRow));
            }

            if (headerFields) {
              for (const record of prepared) {
                const row = headerFields.map((field) => escapeCsvValue(record[field], csvOptions)).join(',') + '\n';
                controller.enqueue(encoder.encode(row));
              }
            }

            exported += records.length;
            page++;

            if (records.length < pageSize) break;
          }
        } catch (err) {
          controller.error(err);
          return;
        }

        controller.close();
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
    // Override pagination to fetch all records up to the limit (hard cap at 100k)
    const effectiveLimit = Math.min(this.maxExportRecords, 100_000);
    const exportFilters: ListFilters = {
      ...filters,
      options: {
        ...filters.options,
        page: 1,
        per_page: effectiveLimit,
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

    // Use paginated streaming for CSV when streaming is requested
    if (exportOptions.format === 'csv' && exportOptions.stream) {
      return this.exportAsCsvStreamPaginated(filters, exportOptions.format);
    }

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
      return this.exportAsCsv(preparedRecords, exportOptions.format);
    }

    // Default: JSON
    return this.exportAsJson(preparedRecords, exportOptions.format);
  }
}
