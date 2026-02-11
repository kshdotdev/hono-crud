/**
 * Build a serialized context string from records for the AI prompt.
 * Includes only the specified fields and respects length limits.
 */
export function buildRecordContext(
  records: Record<string, unknown>[],
  options: {
    contextFields?: string[];
    maxContextLength?: number;
  } = {}
): string {
  const { contextFields, maxContextLength = 8000 } = options;

  if (records.length === 0) {
    return 'No records found.';
  }

  const lines: string[] = [];
  lines.push(`Total records: ${records.length}`);
  lines.push('---');

  let currentLength = lines.join('\n').length;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const filtered = contextFields
      ? filterFields(record, contextFields)
      : record;

    const line = `Record ${i + 1}: ${JSON.stringify(filtered)}`;

    // Check if adding this line would exceed the limit
    if (currentLength + line.length + 1 > maxContextLength) {
      lines.push(`... (${records.length - i} more records truncated)`);
      break;
    }

    lines.push(line);
    currentLength += line.length + 1;
  }

  return lines.join('\n');
}

/**
 * Filter a record to include only the specified fields.
 */
function filterFields(
  record: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in record) {
      result[field] = record[field];
    }
  }
  return result;
}
