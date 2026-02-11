import type { ZodObject, ZodRawShape } from 'zod';
import type { FilterOperator } from '../../core/types';
import type { FieldDescription } from '../types';

/**
 * Build field descriptions from a Zod schema and filter configuration.
 * These descriptions are used in the AI prompt so the model knows
 * which fields and operators are available.
 */
export function buildFieldDescriptions(
  schema: ZodObject<ZodRawShape>,
  filterFields: string[],
  filterConfig?: Record<string, FilterOperator[]>,
  sortFields?: string[]
): FieldDescription[] {
  const descriptions: FieldDescription[] = [];
  const shape = schema.shape;
  const processedFields = new Set<string>();

  // Process filter config (fields with specific operators)
  if (filterConfig) {
    for (const [field, operators] of Object.entries(filterConfig)) {
      if (!(field in shape)) continue;
      processedFields.add(field);
      descriptions.push({
        name: field,
        type: inferZodType(shape[field]),
        operators: [...operators, 'eq'] as FilterOperator[],
      });
    }
  }

  // Process simple filter fields (equality only)
  for (const field of filterFields) {
    if (processedFields.has(field)) continue;
    if (!(field in shape)) continue;
    processedFields.add(field);
    descriptions.push({
      name: field,
      type: inferZodType(shape[field]),
      operators: ['eq'],
    });
  }

  // Mark sortable fields
  if (sortFields) {
    for (const desc of descriptions) {
      if (sortFields.includes(desc.name)) {
        // Already included, just note it's sortable in the description
      }
    }
    // Add sort-only fields that aren't filterable
    for (const field of sortFields) {
      if (!processedFields.has(field) && field in shape) {
        descriptions.push({
          name: field,
          type: inferZodType(shape[field]),
          operators: [],
        });
      }
    }
  }

  return descriptions;
}

/**
 * Infer a human-readable type name from a Zod schema node.
 */
function inferZodType(zodType: unknown): string {
  if (!zodType || typeof zodType !== 'object') return 'unknown';

  const t = zodType as Record<string, unknown>;

  // Check _zod property (Zod v4 style)
  if (t._zod && typeof t._zod === 'object') {
    const zod = t._zod as Record<string, unknown>;
    if (typeof zod.def === 'object' && zod.def !== null) {
      const def = zod.def as Record<string, unknown>;
      const typeName = def.type;
      if (typeof typeName === 'string') {
        return mapZodTypeName(typeName);
      }
    }
  }

  // Check _def property (Zod v3 style)
  if (t._def && typeof t._def === 'object') {
    const def = t._def as Record<string, unknown>;
    const typeName = def.typeName;
    if (typeof typeName === 'string') {
      return mapZodTypeName(typeName);
    }
  }

  // Try description from Zod schema
  if (typeof t.description === 'string') {
    return t.description;
  }

  return 'unknown';
}

function mapZodTypeName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('string')) return 'string';
  if (lower.includes('number') || lower.includes('int') || lower.includes('float')) return 'number';
  if (lower.includes('boolean') || lower.includes('bool')) return 'boolean';
  if (lower.includes('date')) return 'date';
  if (lower.includes('enum')) return 'enum';
  if (lower.includes('array')) return 'array';
  if (lower.includes('uuid')) return 'string (uuid)';
  return name;
}
