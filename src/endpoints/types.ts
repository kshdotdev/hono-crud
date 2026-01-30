import type { ZodObject, ZodRawShape, z } from 'zod';
import type {
  FilterConfig,
  FilterCondition,
  FilterOperator,
  HookMode,
  ListFilters,
  ListOptions,
  MetaInput,
  Model,
  InferModel,
  InferMeta,
  SchemaKeys,
  defineModel,
  defineMeta,
} from '../core/types';

// Re-export core types
export type {
  FilterConfig,
  FilterCondition,
  FilterOperator,
  HookMode,
  ListFilters,
  ListOptions,
  MetaInput,
  Model,
  InferModel,
  InferMeta,
  SchemaKeys,
};
export { defineModel, defineMeta };

// List endpoint configuration
export interface ListEndpointConfig {
  // Filter configuration
  filterFields?: string[];
  filterConfig?: FilterConfig;

  // Search configuration
  searchFields?: string[];
  searchFieldName?: string;

  // Sorting configuration
  sortFields?: string[];
  defaultSort?: { field: string; order: 'asc' | 'desc' };

  // Pagination configuration
  defaultPerPage?: number;
  maxPerPage?: number;

  // Soft delete configuration
  softDeleteQueryParam?: string;

  // Relations configuration
  allowedIncludes?: string[];

  // Field selection configuration
  fieldSelectionEnabled?: boolean;
  allowedSelectFields?: string[];
  blockedSelectFields?: string[];
  alwaysIncludeFields?: string[];
  defaultSelectFields?: string[];
}

// Read/Update/Delete endpoint configuration
export interface SingleEndpointConfig {
  lookupField?: string;
  lookupFields?: string[];
  additionalFilters?: string[];
}

// Update endpoint configuration
export interface UpdateEndpointConfig extends SingleEndpointConfig {
  allowedUpdateFields?: string[];
  blockedUpdateFields?: string[];
}

// Parse query string filter syntax
export function parseFilterValue(
  value: string
): { operator: FilterOperator; value: unknown } {
  // Check for operator syntax: field[operator]=value
  const operatorMatch = value.match(/^\[([a-z]+)\](.*)$/);
  if (operatorMatch) {
    const operator = operatorMatch[1] as FilterOperator;
    let parsedValue: unknown = operatorMatch[2];

    // Handle array operators
    if (operator === 'in' || operator === 'nin') {
      parsedValue = (parsedValue as string).split(',').map((v) => v.trim());
    } else if (operator === 'between') {
      parsedValue = (parsedValue as string).split(',').map((v) => v.trim());
    } else if (operator === 'null') {
      parsedValue = (parsedValue as string).toLowerCase() === 'true';
    }

    return { operator, value: parsedValue };
  }

  // Default to equality
  return { operator: 'eq', value };
}

// Parse query parameters into list filters
export function parseListFilters(
  query: Record<string, unknown>,
  config: ListEndpointConfig
): ListFilters {
  const filters: FilterCondition[] = [];
  const options: ListOptions = {};

  const {
    filterFields = [],
    filterConfig = {},
    searchFields = [],
    searchFieldName = 'search',
    sortFields = [],
    defaultSort,
    defaultPerPage = 20,
    maxPerPage = 100,
    softDeleteQueryParam = 'withDeleted',
    allowedIncludes = [],
    fieldSelectionEnabled = false,
    allowedSelectFields = [],
    blockedSelectFields = [],
    alwaysIncludeFields = [],
    defaultSelectFields = [],
  } = config;

  // Build allowed filters map
  const allowedFilters: FilterConfig = {};
  for (const field of filterFields) {
    allowedFilters[field] = ['eq'];
  }
  Object.assign(allowedFilters, filterConfig);

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) continue;

    const value = String(rawValue);

    // Handle pagination
    if (key === 'page') {
      options.page = Math.max(1, parseInt(value, 10) || 1);
      continue;
    }
    if (key === 'per_page') {
      options.per_page = Math.min(maxPerPage, Math.max(1, parseInt(value, 10) || defaultPerPage));
      continue;
    }

    // Handle sorting (?sort=field&order=asc|desc)
    if (key === 'sort') {
      if (sortFields.length === 0 || sortFields.includes(value)) {
        options.order_by = value;
      }
      continue;
    }
    if (key === 'order') {
      if (value === 'asc' || value === 'desc') {
        options.order_by_direction = value;
      }
      continue;
    }

    // Handle search
    if (key === searchFieldName && searchFields.length > 0) {
      options.search = value;
      continue;
    }

    // Handle soft delete query params
    if (key === softDeleteQueryParam) {
      options.withDeleted = value.toLowerCase() === 'true';
      continue;
    }
    if (key === 'onlyDeleted') {
      options.onlyDeleted = value.toLowerCase() === 'true';
      continue;
    }

    // Handle include parameter for relations
    if (key === 'include') {
      const requested = value.split(',').map((v) => v.trim()).filter(Boolean);
      if (allowedIncludes && allowedIncludes.length > 0) {
        // Filter to only allowed includes
        options.include = requested.filter((r) => allowedIncludes.includes(r));
      } else {
        options.include = requested;
      }
      continue;
    }

    // Handle fields parameter for field selection
    if (key === 'fields' && fieldSelectionEnabled) {
      const requested = value.split(',').map((v) => v.trim()).filter(Boolean);
      let selected = requested;

      // Filter to allowed fields if specified
      if (allowedSelectFields.length > 0) {
        selected = selected.filter((f) => allowedSelectFields.includes(f));
      }

      // Remove blocked fields
      if (blockedSelectFields.length > 0) {
        selected = selected.filter((f) => !blockedSelectFields.includes(f));
      }

      // Always include required fields
      if (alwaysIncludeFields.length > 0) {
        selected = [...new Set([...alwaysIncludeFields, ...selected])];
      }

      options.fields = selected;
      continue;
    }

    // Handle filters with bracket syntax: field[operator]=value
    const bracketMatch = key.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([a-z]+)\]$/);
    if (bracketMatch) {
      const field = bracketMatch[1];
      const operator = bracketMatch[2] as FilterOperator;

      if (allowedFilters[field]?.includes(operator)) {
        let parsedValue: unknown = value;

        if (operator === 'in' || operator === 'nin') {
          parsedValue = value.split(',').map((v) => v.trim());
        } else if (operator === 'between') {
          parsedValue = value.split(',').map((v) => v.trim());
        } else if (operator === 'null') {
          parsedValue = value.toLowerCase() === 'true';
        }

        filters.push({ field, operator, value: parsedValue });
      }
      continue;
    }

    // Handle simple field=value filters
    if (allowedFilters[key]) {
      filters.push({ field: key, operator: 'eq', value });
    }
  }

  // Apply defaults
  if (!options.page) options.page = 1;
  if (!options.per_page) options.per_page = defaultPerPage;
  if (!options.order_by && defaultSort?.field) options.order_by = defaultSort.field;
  if (!options.order_by_direction) options.order_by_direction = defaultSort?.order ?? 'asc';

  // Apply default fields if field selection is enabled but no fields were specified
  if (fieldSelectionEnabled && !options.fields && defaultSelectFields.length > 0) {
    let selected = [...defaultSelectFields];
    if (alwaysIncludeFields.length > 0) {
      selected = [...new Set([...alwaysIncludeFields, ...selected])];
    }
    options.fields = selected;
  }

  return { filters, options };
}

// Helper to extract schema fields for create/update
export function getSchemaFields<T extends ZodObject<ZodRawShape>>(
  schema: T,
  exclude: string[] = []
): ZodObject<ZodRawShape> {
  const shape = schema.shape;
  // Use Record for mutable shape building (ZodRawShape is readonly in Zod v4)
  const filteredShape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(shape)) {
    if (!exclude.includes(key)) {
      filteredShape[key] = value as z.ZodTypeAny;
    }
  }

  return schema.pick(
    Object.keys(filteredShape).reduce(
      (acc, key) => ({ ...acc, [key]: true }),
      {}
    )
  ) as unknown as ZodObject<ZodRawShape>;
}

// Infer the object type from a model
export type ModelObject<M extends Model> = z.infer<M['schema']>;

// ============================================================================
// Field Selection Types
// ============================================================================

/**
 * Configuration for field selection on endpoints.
 */
export interface FieldSelectionConfig {
  /**
   * Fields that are allowed to be selected.
   * If empty, all schema fields are allowed.
   */
  allowedFields?: string[];

  /**
   * Fields that are never returned, even if requested.
   * Useful for sensitive fields like passwords.
   */
  blockedFields?: string[];

  /**
   * Fields that are always included in the response,
   * regardless of what the client requests.
   * Typically includes primary keys.
   */
  alwaysIncludeFields?: string[];

  /**
   * Default fields to return when no fields parameter is provided.
   * If empty, returns all allowed fields.
   */
  defaultFields?: string[];

  /**
   * Whether to allow selecting computed fields.
   * @default true
   */
  allowComputedFields?: boolean;

  /**
   * Whether to allow selecting relation fields.
   * @default true
   */
  allowRelationFields?: boolean;
}

/**
 * Parsed field selection from query parameters.
 */
export interface FieldSelection {
  /** The fields to include in the response */
  fields: string[];
  /** Whether field selection is active (fields param was provided) */
  isActive: boolean;
}

/**
 * Parse the fields query parameter.
 *
 * @param fieldsParam - The raw fields parameter value (comma-separated string)
 * @param config - Field selection configuration
 * @param schemaFields - Available fields from the schema
 * @param computedFields - Available computed field names
 * @param relationFields - Available relation field names
 * @returns Parsed field selection
 */
export function parseFieldSelection(
  fieldsParam: string | undefined | null,
  config: FieldSelectionConfig = {},
  schemaFields: string[] = [],
  computedFields: string[] = [],
  relationFields: string[] = []
): FieldSelection {
  const {
    allowedFields = [],
    blockedFields = [],
    alwaysIncludeFields = [],
    defaultFields = [],
    allowComputedFields = true,
    allowRelationFields = true,
  } = config;

  // If no fields parameter provided, return default or all fields
  if (!fieldsParam || typeof fieldsParam !== 'string' || fieldsParam.trim() === '') {
    if (defaultFields.length > 0) {
      return {
        fields: [...new Set([...alwaysIncludeFields, ...defaultFields])],
        isActive: false,
      };
    }
    return { fields: [], isActive: false };
  }

  // Parse requested fields
  const requested = fieldsParam
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  // Build set of all available fields
  const available = new Set<string>();

  // Add schema fields
  for (const field of schemaFields) {
    if (allowedFields.length === 0 || allowedFields.includes(field)) {
      if (!blockedFields.includes(field)) {
        available.add(field);
      }
    }
  }

  // Add computed fields if allowed
  if (allowComputedFields) {
    for (const field of computedFields) {
      if (allowedFields.length === 0 || allowedFields.includes(field)) {
        if (!blockedFields.includes(field)) {
          available.add(field);
        }
      }
    }
  }

  // Add relation fields if allowed
  if (allowRelationFields) {
    for (const field of relationFields) {
      if (allowedFields.length === 0 || allowedFields.includes(field)) {
        if (!blockedFields.includes(field)) {
          available.add(field);
        }
      }
    }
  }

  // Filter to only available fields
  const selected = requested.filter((f) => available.has(f));

  // Always include required fields
  const result = [...new Set([...alwaysIncludeFields, ...selected])];

  return {
    fields: result,
    isActive: true,
  };
}

/**
 * Apply field selection to a single record.
 *
 * @param record - The record to filter
 * @param selection - The field selection
 * @returns The record with only selected fields
 */
export function applyFieldSelection<T extends Record<string, unknown>>(
  record: T,
  selection: FieldSelection
): Record<string, unknown> {
  // If selection is not active, return all fields
  if (!selection.isActive || selection.fields.length === 0) {
    return record;
  }

  const result: Record<string, unknown> = {};
  for (const field of selection.fields) {
    if (field in record) {
      result[field] = record[field];
    }
  }
  return result;
}

/**
 * Apply field selection to an array of records.
 *
 * @param records - The records to filter
 * @param selection - The field selection
 * @returns The records with only selected fields
 */
export function applyFieldSelectionToArray<T extends Record<string, unknown>>(
  records: T[],
  selection: FieldSelection
): Array<Record<string, unknown>> {
  // If selection is not active, return all fields
  if (!selection.isActive || selection.fields.length === 0) {
    return records;
  }

  return records.map((record) => applyFieldSelection(record, selection));
}
