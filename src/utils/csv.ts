import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod';

// ============================================================================
// CSV Types
// ============================================================================

/**
 * Options for CSV generation.
 */
export interface CsvGenerateOptions {
  /** Column headers. If not provided, uses object keys from first record. */
  headers?: string[];
  /** Custom header labels for display (maps field name to label). */
  headerLabels?: Record<string, string>;
  /** Field delimiter (default: comma). */
  delimiter?: string;
  /** Row delimiter (default: CRLF for RFC 4180 compliance). */
  rowDelimiter?: string;
  /** Whether to include header row (default: true). */
  includeHeader?: boolean;
  /** Custom value formatter per field. */
  formatters?: Record<string, (value: unknown) => string>;
  /** Fields to exclude from output. */
  excludeFields?: string[];
  /** Date format (default: ISO 8601). */
  dateFormat?: 'iso' | 'locale' | 'timestamp';
  /** How to handle null/undefined values (default: empty string). */
  nullValue?: string;
}

/**
 * Options for CSV parsing.
 */
export interface CsvParseOptions {
  /** Field delimiter (default: comma). */
  delimiter?: string;
  /** Whether the first row contains headers (default: true). */
  hasHeader?: boolean;
  /** Custom headers to use (overrides headers from file). */
  headers?: string[];
  /** Whether to trim whitespace from values (default: true). */
  trimValues?: boolean;
  /** Whether to skip empty rows (default: true). */
  skipEmptyRows?: boolean;
  /** Custom value parser per field. */
  parsers?: Record<string, (value: string) => unknown>;
  /** How to handle empty strings (default: keep as empty string). */
  emptyValue?: 'null' | 'undefined' | 'empty';
}

/**
 * Result of CSV parsing.
 */
export interface CsvParseResult<T = Record<string, unknown>> {
  /** Parsed records. */
  data: T[];
  /** Headers from the CSV (if hasHeader was true). */
  headers: string[];
  /** Errors encountered during parsing (row-level). */
  errors: CsvParseError[];
}

/**
 * Error encountered during CSV parsing.
 */
export interface CsvParseError {
  /** Row number (1-indexed). */
  row: number;
  /** Error message. */
  message: string;
  /** The raw row content. */
  content?: string;
}

/**
 * Result of CSV header validation against a schema.
 */
export interface CsvValidationResult {
  /** Whether validation passed. */
  valid: boolean;
  /** Missing required fields. */
  missingFields: string[];
  /** Unknown fields not in schema. */
  unknownFields: string[];
  /** Valid fields that can be imported. */
  validFields: string[];
}

// ============================================================================
// CSV Generation
// ============================================================================

/**
 * Escapes a value for CSV output according to RFC 4180.
 * Values containing delimiter, quotes, or newlines are quoted.
 */
export function escapeCsvValue(
  value: unknown,
  options: Pick<CsvGenerateOptions, 'delimiter' | 'nullValue' | 'dateFormat'> = {}
): string {
  const { delimiter = ',', nullValue = '', dateFormat = 'iso' } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    return nullValue;
  }

  // Handle dates
  if (value instanceof Date) {
    switch (dateFormat) {
      case 'timestamp':
        return String(value.getTime());
      case 'locale':
        return value.toLocaleString();
      case 'iso':
      default:
        return value.toISOString();
    }
  }

  // Handle arrays and objects
  if (typeof value === 'object') {
    return escapeCsvValue(JSON.stringify(value), options);
  }

  // Handle booleans
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // Convert to string
  const str = String(value);

  // Check if quoting is needed (contains delimiter, quotes, or newlines)
  const needsQuoting =
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (needsQuoting) {
    // Escape double quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Generates a CSV string from an array of records.
 *
 * @param records - Array of objects to convert to CSV
 * @param options - Generation options
 * @returns CSV string
 *
 * @example
 * ```ts
 * const csv = generateCsv([
 *   { id: '1', name: 'Alice', email: 'alice@example.com' },
 *   { id: '2', name: 'Bob', email: 'bob@example.com' },
 * ]);
 * // Result:
 * // id,name,email
 * // 1,Alice,alice@example.com
 * // 2,Bob,bob@example.com
 * ```
 */
export function generateCsv<T extends Record<string, unknown>>(
  records: T[],
  options: CsvGenerateOptions = {}
): string {
  const {
    delimiter = ',',
    rowDelimiter = '\r\n',
    includeHeader = true,
    formatters = {},
    excludeFields = [],
    headerLabels = {},
    nullValue = '',
    dateFormat = 'iso',
  } = options;

  if (records.length === 0) {
    return '';
  }

  // Determine headers from options or first record
  let headers = options.headers;
  if (!headers) {
    headers = Object.keys(records[0]).filter((h) => !excludeFields.includes(h));
  } else {
    headers = headers.filter((h) => !excludeFields.includes(h));
  }

  const lines: string[] = [];

  // Add header row
  if (includeHeader) {
    const headerRow = headers.map((h) => {
      const label = headerLabels[h] || h;
      return escapeCsvValue(label, { delimiter, nullValue, dateFormat });
    });
    lines.push(headerRow.join(delimiter));
  }

  // Add data rows
  for (const record of records) {
    const row = headers.map((header) => {
      let value = record[header];

      // Apply custom formatter if provided
      if (formatters[header]) {
        value = formatters[header](value);
      }

      return escapeCsvValue(value, { delimiter, nullValue, dateFormat });
    });
    lines.push(row.join(delimiter));
  }

  return lines.join(rowDelimiter);
}

/**
 * Creates a ReadableStream that generates CSV data in chunks.
 * Useful for large exports to avoid memory issues.
 *
 * @param records - Array of objects to convert to CSV
 * @param options - Generation options
 * @returns ReadableStream of CSV data
 *
 * @example
 * ```ts
 * const stream = createCsvStream(largeDataset, { headers: ['id', 'name'] });
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/csv' },
 * });
 * ```
 */
export function createCsvStream<T extends Record<string, unknown>>(
  records: T[],
  options: CsvGenerateOptions = {}
): ReadableStream<Uint8Array> {
  const {
    delimiter = ',',
    rowDelimiter = '\r\n',
    includeHeader = true,
    formatters = {},
    excludeFields = [],
    headerLabels = {},
    nullValue = '',
    dateFormat = 'iso',
  } = options;

  const encoder = new TextEncoder();
  let index = 0;
  let headerSent = false;

  // Determine headers
  let headers = options.headers;
  if (!headers && records.length > 0) {
    headers = Object.keys(records[0]).filter((h) => !excludeFields.includes(h));
  } else if (headers) {
    headers = headers.filter((h) => !excludeFields.includes(h));
  } else {
    headers = [];
  }

  return new ReadableStream({
    pull(controller) {
      // Send header first
      if (includeHeader && !headerSent && headers.length > 0) {
        const headerRow = headers.map((h) => {
          const label = headerLabels[h] || h;
          return escapeCsvValue(label, { delimiter, nullValue, dateFormat });
        });
        controller.enqueue(encoder.encode(headerRow.join(delimiter) + rowDelimiter));
        headerSent = true;
        return;
      }

      // Send data rows in chunks
      const chunkSize = 100;
      const chunk: string[] = [];

      while (index < records.length && chunk.length < chunkSize) {
        const record = records[index];
        const row = headers.map((header) => {
          let value = record[header];
          if (formatters[header]) {
            value = formatters[header](value);
          }
          return escapeCsvValue(value, { delimiter, nullValue, dateFormat });
        });
        chunk.push(row.join(delimiter));
        index++;
      }

      if (chunk.length > 0) {
        controller.enqueue(encoder.encode(chunk.join(rowDelimiter) + rowDelimiter));
      }

      if (index >= records.length) {
        controller.close();
      }
    },
  });
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parses a CSV value, handling quoted strings.
 */
function parseCsvField(field: string, delimiter: string): string {
  field = field.trim();

  // Check if field is quoted
  if (field.startsWith('"') && field.endsWith('"')) {
    // Remove surrounding quotes and unescape doubled quotes
    return field.slice(1, -1).replace(/""/g, '"');
  }

  return field;
}

/**
 * Parses a CSV line into fields, handling quoted values with embedded delimiters.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === delimiter) {
        fields.push(current);
        current = '';
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  // Don't forget the last field
  fields.push(current);

  return fields;
}

/**
 * Splits CSV content into lines, handling newlines within quoted fields.
 */
function splitCsvLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      // Check for escaped quote
      if (inQuotes && i + 1 < content.length && content[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      // Handle \r\n
      if (char === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
        i++;
      }
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  // Don't forget the last line
  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

/**
 * Parses a CSV string into an array of records.
 *
 * @param content - CSV string content
 * @param options - Parsing options
 * @returns Parsed result with data, headers, and any errors
 *
 * @example
 * ```ts
 * const result = parseCsv(`
 * id,name,email
 * 1,Alice,alice@example.com
 * 2,Bob,bob@example.com
 * `);
 * // result.data = [
 * //   { id: '1', name: 'Alice', email: 'alice@example.com' },
 * //   { id: '2', name: 'Bob', email: 'bob@example.com' },
 * // ]
 * ```
 */
export function parseCsv<T = Record<string, unknown>>(
  content: string,
  options: CsvParseOptions = {}
): CsvParseResult<T> {
  const {
    delimiter = ',',
    hasHeader = true,
    trimValues = true,
    skipEmptyRows = true,
    parsers = {},
    emptyValue = 'empty',
  } = options;

  const result: CsvParseResult<T> = {
    data: [],
    headers: [],
    errors: [],
  };

  // Split into lines, handling newlines in quoted fields
  const lines = splitCsvLines(content);

  if (lines.length === 0) {
    return result;
  }

  let startIndex = 0;

  // Extract headers
  if (hasHeader) {
    const headerLine = lines[0];
    result.headers = parseCsvLine(headerLine, delimiter).map((h) =>
      trimValues ? h.trim() : h
    );
    startIndex = 1;
  } else if (options.headers) {
    result.headers = options.headers;
  }

  // Use provided headers or extracted headers
  const headers = options.headers || result.headers;

  // Parse data rows
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const rowNum = i + 1;

    // Skip empty rows if configured
    if (skipEmptyRows && line.trim() === '') {
      continue;
    }

    try {
      const fields = parseCsvLine(line, delimiter);
      const record: Record<string, unknown> = {};

      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        let value: unknown = j < fields.length ? fields[j] : '';

        // Trim if configured
        if (trimValues && typeof value === 'string') {
          value = value.trim();
        }

        // Handle empty values
        if (value === '') {
          switch (emptyValue) {
            case 'null':
              value = null;
              break;
            case 'undefined':
              value = undefined;
              break;
            // 'empty' keeps it as empty string
          }
        }

        // Apply custom parser if provided
        if (parsers[header] && typeof value === 'string') {
          try {
            value = parsers[header](value);
          } catch (e) {
            result.errors.push({
              row: rowNum,
              message: `Failed to parse field "${header}": ${e instanceof Error ? e.message : String(e)}`,
              content: line,
            });
          }
        }

        record[header] = value;
      }

      result.data.push(record as T);
    } catch (e) {
      result.errors.push({
        row: rowNum,
        message: `Failed to parse row: ${e instanceof Error ? e.message : String(e)}`,
        content: line,
      });
    }
  }

  return result;
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validates CSV headers against a Zod schema.
 * Returns information about missing required fields, unknown fields, and valid fields.
 *
 * @param headers - Headers from the CSV file
 * @param schema - Zod object schema to validate against
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```ts
 * const UserSchema = z.object({
 *   id: z.string(),
 *   name: z.string(),
 *   email: z.email(),
 *   age: z.number().optional(),
 * });
 *
 * const result = validateCsvHeaders(['name', 'email', 'unknown'], UserSchema);
 * // result.valid = false (missing required 'id')
 * // result.missingFields = ['id']
 * // result.unknownFields = ['unknown']
 * // result.validFields = ['name', 'email']
 * ```
 */
export function validateCsvHeaders<T extends ZodObject<ZodRawShape>>(
  headers: string[],
  schema: T,
  options: { allowUnknownFields?: boolean; optionalFields?: string[] } = {}
): CsvValidationResult {
  const { allowUnknownFields = false, optionalFields = [] } = options;

  const schemaShape = schema.shape;
  const schemaFields = Object.keys(schemaShape);

  // Determine required fields
  const requiredFields = schemaFields.filter((field) => {
    if (optionalFields.includes(field)) {
      return false;
    }
    const fieldSchema = schemaShape[field] as ZodTypeAny;
    // Check if the field is optional in the schema
    return !fieldSchema.isOptional();
  });

  // Find missing required fields
  const missingFields = requiredFields.filter((field) => !headers.includes(field));

  // Find unknown fields
  const unknownFields = headers.filter((header) => !schemaFields.includes(header));

  // Find valid fields
  const validFields = headers.filter((header) => schemaFields.includes(header));

  // Validation passes if no missing required fields and (unknown fields allowed or none exist)
  const valid = missingFields.length === 0 && (allowUnknownFields || unknownFields.length === 0);

  return {
    valid,
    missingFields,
    unknownFields,
    validFields,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Infers the content type from a file name or content.
 */
export function inferCsvContentType(
  filename?: string,
  content?: string
): 'csv' | 'json' | 'unknown' {
  if (filename) {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';
  }

  if (content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return 'json';
    }
    // Basic CSV heuristic: contains commas and/or newlines with similar field counts
    if (trimmed.includes(',') || trimmed.includes('\n')) {
      return 'csv';
    }
  }

  return 'unknown';
}

/**
 * Converts JSON array to CSV format.
 */
export function jsonToCsv<T extends Record<string, unknown>>(
  json: T[],
  options: CsvGenerateOptions = {}
): string {
  return generateCsv(json, options);
}

/**
 * Converts CSV string to JSON array.
 */
export function csvToJson<T = Record<string, unknown>>(
  csv: string,
  options: CsvParseOptions = {}
): T[] {
  const result = parseCsv<T>(csv, options);
  return result.data;
}
