import type { FieldDescription } from '../types';

/**
 * Build the system prompt for NL-to-filter translation.
 */
export function buildNLQuerySystemPrompt(
  fields: FieldDescription[],
  sortFields: string[],
  domainContext?: string
): string {
  const now = new Date().toISOString().split('T')[0];

  const fieldDescriptions = fields
    .map((f) => {
      const ops = f.operators.length > 0
        ? `operators: [${f.operators.join(', ')}]`
        : 'not filterable';
      return `  - ${f.name} (${f.type}): ${ops}`;
    })
    .join('\n');

  const sortDescription = sortFields.length > 0
    ? `\nSortable fields: ${sortFields.join(', ')}`
    : '';

  const domainBlock = domainContext
    ? `\nDomain context: ${domainContext}\n`
    : '';

  return `You are a query translator. Convert natural language queries into structured filter objects.

Current date: ${now}
${domainBlock}
Available fields:
${fieldDescriptions}
${sortDescription}

Rules:
- Only use fields and operators listed above
- For date fields, use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)
- For "last week", "this month", etc., calculate relative to the current date
- For "between" operator, value must be an array of exactly 2 elements
- For "in" and "nin" operators, value must be an array
- For "null" operator, value must be a boolean (true = is null, false = is not null)
- For "like" and "ilike" operators, use % as wildcard (e.g., "%admin%")
- Set confidence to a value between 0 and 1 indicating how confident you are in the translation
- Provide a brief human-readable interpretation of the query
- If the query is ambiguous or cannot be translated, set confidence below 0.5 and explain in the interpretation`;
}
