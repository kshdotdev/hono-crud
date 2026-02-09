import type { z, ZodObject, ZodRawShape, ZodType } from 'zod';
import type { Context, Env } from 'hono';
import type { RouteConfig } from '@hono/zod-openapi';

// ============================================================================
// Schema Type Utilities
// ============================================================================

/**
 * Infer the TypeScript type from a Zod schema.
 */
export type InferSchema<T extends ZodType> = z.infer<T>;

/**
 * Extract keys from a Zod object schema.
 */
export type SchemaKeys<T extends ZodObject<ZodRawShape>> = keyof z.infer<T>;

// ============================================================================
// Filter Types
// ============================================================================

// Filter operators for list queries
export type FilterOperator =
  | 'eq'      // equals
  | 'ne'      // not equals
  | 'gt'      // greater than
  | 'gte'     // greater than or equal
  | 'lt'      // less than
  | 'lte'     // less than or equal
  | 'in'      // in array
  | 'nin'     // not in array
  | 'like'    // SQL LIKE
  | 'ilike'   // case-insensitive LIKE
  | 'null'    // is null
  | 'between'; // between two values

// Filter configuration per field
export type FilterConfig = {
  [field: string]: FilterOperator[];
};

// Parsed filter condition
export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

// List query options
export interface ListOptions {
  page?: number;
  per_page?: number;
  order_by?: string;
  order_by_direction?: 'asc' | 'desc';
  search?: string;
  /** Include soft-deleted records in results */
  withDeleted?: boolean;
  /** Show only soft-deleted records */
  onlyDeleted?: boolean;
  /** Relations to include in the response */
  include?: string[];
  /** Fields to include in the response (field selection) */
  fields?: string[];
  /** Cursor for cursor-based pagination (opaque string, typically base64-encoded) */
  cursor?: string;
  /** Maximum number of items to return (for cursor pagination) */
  limit?: number;
}

// List filters parsed from query
export interface ListFilters {
  filters: FilterCondition[];
  options: ListOptions;
}

// Pagination result
export interface PaginatedResult<T> {
  result: T[];
  result_info: {
    page: number;
    per_page: number;
    total_count?: number;
    total_pages?: number;
    /** Whether there is a next page available */
    has_next_page: boolean;
    /** Whether there is a previous page available */
    has_prev_page: boolean;
    /** Cursor for fetching the next page (cursor-based pagination) */
    next_cursor?: string;
    /** Cursor for fetching the previous page (cursor-based pagination) */
    prev_cursor?: string;
  };
}

// ============================================================================
// Cursor Pagination Utilities
// ============================================================================

/**
 * Encodes a cursor value to an opaque base64 string.
 */
export function encodeCursor(value: string | number): string {
  return btoa(String(value));
}

/**
 * Decodes an opaque cursor string back to the original value.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): string | null {
  try {
    return atob(cursor);
  } catch {
    return null;
  }
}

// ============================================================================
// Relation Types
// ============================================================================

/**
 * Relation type definitions for models.
 */
export type RelationType = 'hasOne' | 'hasMany' | 'belongsTo';

/**
 * Cascade behavior when deleting a parent record.
 */
export type CascadeAction =
  | 'cascade'    // Delete related records
  | 'setNull'    // Set foreign key to null
  | 'restrict'   // Prevent delete if related records exist
  | 'noAction';  // Do nothing (default)

/**
 * Configuration for cascade operations on a relation.
 */
export interface CascadeConfig {
  /**
   * Action to take when the parent record is deleted.
   * @default 'noAction'
   */
  onDelete?: CascadeAction;

  /**
   * Action to take when the parent record is soft-deleted.
   * @default 'noAction'
   */
  onSoftDelete?: CascadeAction;
}

/**
 * Configuration for a single relation.
 */
export interface RelationConfig<TTable = unknown> {
  /** Type of relation */
  type: RelationType;
  /** The related model's table name */
  model: string;
  /** Foreign key field name */
  foreignKey: string;
  /** Local key field name (defaults to primary key) */
  localKey?: string;
  /** Related model's schema for response typing */
  schema?: ZodObject<ZodRawShape>;
  /** ORM table reference for the related model (required for Drizzle) */
  table?: TTable;
  /**
   * Configuration for nested write operations.
   * When defined, allows creating/updating related records in the same request.
   */
  nestedWrites?: NestedWriteConfig;
  /**
   * Configuration for cascade operations when parent is deleted.
   */
  cascade?: CascadeConfig;
}

/**
 * Map of relation names to their configurations.
 */
export type RelationsConfig = Record<string, RelationConfig>;

/**
 * Parsed include options from query string.
 */
export interface IncludeOptions {
  /** List of relation names to include */
  relations: string[];
}

// ============================================================================
// Nested Write Types
// ============================================================================

/**
 * Configuration for nested write operations on a relation.
 */
export interface NestedWriteConfig {
  /**
   * Allow creating related records when creating the parent.
   * @default false
   */
  allowCreate?: boolean;

  /**
   * Allow updating related records when updating the parent.
   * @default false
   */
  allowUpdate?: boolean;

  /**
   * Allow deleting related records when updating the parent.
   * @default false
   */
  allowDelete?: boolean;

  /**
   * Allow disconnecting (unlinking) related records.
   * Only applicable for optional relations.
   * @default false
   */
  allowDisconnect?: boolean;

  /**
   * Allow connecting existing records to the parent.
   * @default false
   */
  allowConnect?: boolean;
}

/**
 * Map of relation names to their nested write configurations.
 */
export type NestedWritesConfig = Record<string, NestedWriteConfig>;

/**
 * Input for nested create operations (hasOne relation).
 * Directly provides the data for the related record.
 */
export type NestedCreateOneInput<T = Record<string, unknown>> = T;

/**
 * Input for nested create operations (hasMany relation).
 * Provides an array of data for the related records.
 */
export type NestedCreateManyInput<T = Record<string, unknown>> = T[];

/**
 * Input for nested update operations.
 * Supports create, update, delete, connect, and disconnect operations.
 */
export interface NestedUpdateInput<T = Record<string, unknown>> {
  /**
   * Create new related records.
   */
  create?: T | T[];

  /**
   * Update existing related records (must include the primary key).
   */
  update?: (T & { id: string | number })[];

  /**
   * Delete related records by their IDs.
   */
  delete?: (string | number)[];

  /**
   * Connect existing records by their IDs.
   */
  connect?: (string | number)[];

  /**
   * Disconnect related records by their IDs (sets foreign key to null).
   */
  disconnect?: (string | number)[];

  /**
   * For hasOne: replace the entire related record.
   */
  set?: T | null;
}

/**
 * Result of a nested write operation.
 */
export interface NestedWriteResult<T = Record<string, unknown>> {
  /** Records that were created */
  created: T[];
  /** Records that were updated */
  updated: T[];
  /** IDs of records that were deleted */
  deleted: (string | number)[];
  /** IDs of records that were connected */
  connected: (string | number)[];
  /** IDs of records that were disconnected */
  disconnected: (string | number)[];
}

/**
 * Extract nested write data from a request body.
 *
 * @param data - The request body data
 * @param relationNames - Names of relations that support nested writes
 * @returns Object with main data and nested data separated
 */
export function extractNestedData<T extends Record<string, unknown>>(
  data: T,
  relationNames: string[]
): {
  mainData: Record<string, unknown>;
  nestedData: Record<string, unknown>;
} {
  const mainData: Record<string, unknown> = {};
  const nestedData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (relationNames.includes(key) && value !== undefined) {
      nestedData[key] = value;
    } else {
      mainData[key] = value;
    }
  }

  return { mainData, nestedData };
}

/**
 * Check if nested data is a "create" operation (direct data vs operation object).
 * Direct data: { name: "John" } or [{ name: "John" }]
 * Operation object: { create: [...], update: [...] }
 */
export function isDirectNestedData(data: unknown): boolean {
  if (Array.isArray(data)) {
    return true;
  }
  if (typeof data === 'object' && data !== null) {
    const keys = Object.keys(data);
    const operationKeys = ['create', 'update', 'delete', 'connect', 'disconnect', 'set'];
    return !keys.some((key) => operationKeys.includes(key));
  }
  return false;
}

// ============================================================================
// Audit Log Types
// ============================================================================

/**
 * Type of operation that was performed.
 */
export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'batch_create' | 'batch_update' | 'batch_delete' | 'batch_restore' | 'upsert' | 'batch_upsert';

/**
 * A single field change in an audit log entry.
 */
export interface AuditFieldChange {
  /** Name of the field that changed */
  field: string;
  /** Previous value (undefined for create) */
  oldValue?: unknown;
  /** New value (undefined for delete) */
  newValue?: unknown;
}

/**
 * An audit log entry recording a change to a record.
 */
export interface AuditLogEntry<T = Record<string, unknown>> {
  /** Unique identifier for this audit log entry */
  id: string;
  /** Timestamp when the action occurred */
  timestamp: Date;
  /** Type of action performed */
  action: AuditAction;
  /** Name of the table/model */
  tableName: string;
  /** ID of the record that was modified */
  recordId: string | number;
  /** ID of the user who performed the action (if available) */
  userId?: string;
  /** The record data after the change (for create/update) */
  record?: T;
  /** Previous record data (for update/delete) */
  previousRecord?: T;
  /** List of fields that changed (for update) */
  changes?: AuditFieldChange[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for audit logging on a model.
 */
export interface AuditConfig {
  /**
   * Whether audit logging is enabled.
   * @default false
   */
  enabled: boolean;

  /**
   * Name of the audit log table/store.
   * @default 'audit_logs'
   */
  tableName?: string;

  /**
   * Actions to log.
   * @default ['create', 'update', 'delete']
   */
  actions?: AuditAction[];

  /**
   * Fields to exclude from change tracking.
   * Useful for sensitive fields like passwords.
   * @default []
   */
  excludeFields?: string[];

  /**
   * Whether to store the full record in the audit log.
   * @default true
   */
  storeRecord?: boolean;

  /**
   * Whether to store the previous record (for updates/deletes).
   * @default true
   */
  storePreviousRecord?: boolean;

  /**
   * Whether to track individual field changes.
   * @default true
   */
  trackChanges?: boolean;

  /**
   * Custom function to extract user ID from context.
   * If not provided, will try to get from ctx.get('userId').
   */
  getUserId?: (ctx: unknown) => string | undefined;
}

/**
 * Normalized audit configuration with defaults applied.
 */
export interface NormalizedAuditConfig {
  enabled: boolean;
  tableName: string;
  actions: AuditAction[];
  excludeFields: string[];
  storeRecord: boolean;
  storePreviousRecord: boolean;
  trackChanges: boolean;
  getUserId?: (ctx: unknown) => string | undefined;
}

/**
 * Get normalized audit configuration with defaults.
 */
export function getAuditConfig(config?: AuditConfig): NormalizedAuditConfig {
  if (!config || !config.enabled) {
    return {
      enabled: false,
      tableName: 'audit_logs',
      actions: [],
      excludeFields: [],
      storeRecord: true,
      storePreviousRecord: true,
      trackChanges: true,
    };
  }

  return {
    enabled: true,
    tableName: config.tableName || 'audit_logs',
    actions: config.actions || ['create', 'update', 'delete'],
    excludeFields: config.excludeFields || [],
    storeRecord: config.storeRecord ?? true,
    storePreviousRecord: config.storePreviousRecord ?? true,
    trackChanges: config.trackChanges ?? true,
    getUserId: config.getUserId,
  };
}

/**
 * Calculate field changes between two records.
 */
export function calculateChanges(
  oldRecord: Record<string, unknown> | undefined,
  newRecord: Record<string, unknown> | undefined,
  excludeFields: string[] = []
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];

  if (!oldRecord && !newRecord) {
    return changes;
  }

  const allKeys = new Set([
    ...Object.keys(oldRecord || {}),
    ...Object.keys(newRecord || {}),
  ]);

  for (const key of allKeys) {
    if (excludeFields.includes(key)) continue;

    const oldValue = oldRecord?.[key];
    const newValue = newRecord?.[key];

    // Deep comparison for objects
    const oldStr = JSON.stringify(oldValue);
    const newStr = JSON.stringify(newValue);

    if (oldStr !== newStr) {
      changes.push({
        field: key,
        oldValue,
        newValue,
      });
    }
  }

  return changes;
}

// ============================================================================
// Versioning Types
// ============================================================================

/**
 * A single version history entry.
 */
export interface VersionHistoryEntry<T = Record<string, unknown>> {
  /** Unique ID of this history entry */
  id: string;
  /** The ID of the original record */
  recordId: string | number;
  /** Version number (1, 2, 3, ...) */
  version: number;
  /** The record data at this version */
  data: T;
  /** When this version was created */
  createdAt: Date;
  /** User who made this change (if tracked) */
  changedBy?: string;
  /** Summary of what changed */
  changeReason?: string;
  /** Field-level changes from previous version */
  changes?: AuditFieldChange[];
}

/**
 * Versioning configuration for a model.
 */
export interface VersioningConfig {
  /** Enable versioning for this model */
  enabled: boolean;
  /** Field name for the version counter on the main table (default: 'version') */
  field?: string;
  /** Table name for storing version history (default: '{tableName}_history') */
  historyTable?: string;
  /** Maximum number of versions to keep per record (default: unlimited) */
  maxVersions?: number;
  /** Track who made each change */
  trackChangedBy?: boolean;
  /** Fields to exclude from version history */
  excludeFields?: string[];
  /** Function to get user ID from context */
  getUserId?: (ctx: unknown) => string | undefined;
}

/**
 * Normalized versioning configuration with defaults applied.
 */
export interface NormalizedVersioningConfig {
  enabled: boolean;
  field: string;
  historyTable: string;
  maxVersions: number | null;
  trackChangedBy: boolean;
  excludeFields: string[];
  getUserId?: (ctx: unknown) => string | undefined;
}

/**
 * Get normalized versioning configuration with defaults.
 */
export function getVersioningConfig(
  config: VersioningConfig | undefined,
  tableName: string
): NormalizedVersioningConfig {
  if (!config || !config.enabled) {
    return {
      enabled: false,
      field: 'version',
      historyTable: `${tableName}_history`,
      maxVersions: null,
      trackChangedBy: false,
      excludeFields: [],
    };
  }

  return {
    enabled: true,
    field: config.field || 'version',
    historyTable: config.historyTable || `${tableName}_history`,
    maxVersions: config.maxVersions ?? null,
    trackChangedBy: config.trackChangedBy ?? false,
    excludeFields: config.excludeFields || [],
    getUserId: config.getUserId,
  };
}

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Supported aggregation operations.
 */
export type AggregateOperation = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'countDistinct';

/**
 * A single aggregation definition.
 */
export interface AggregateField {
  /** The operation to perform */
  operation: AggregateOperation;
  /** The field to aggregate (use '*' for count) */
  field: string;
  /** Alias for the result (optional) */
  alias?: string;
}

/**
 * Aggregation query options.
 */
export interface AggregateOptions {
  /** Fields to aggregate */
  aggregations: AggregateField[];
  /** Fields to group by */
  groupBy?: string[];
  /** Filter conditions (applied before aggregation - WHERE) */
  filters?: Record<string, unknown>;
  /** Having conditions (applied after aggregation - HAVING) */
  having?: Record<string, Record<string, unknown>>;
  /** Order by aggregated values */
  orderBy?: string;
  /** Order direction */
  orderDirection?: 'asc' | 'desc';
  /** Limit number of groups */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of an aggregation query.
 */
export interface AggregateResult {
  /** Aggregated values (when no groupBy) */
  values?: Record<string, number | null>;
  /** Grouped results (when groupBy is specified) */
  groups?: Array<{
    /** Group key values */
    key: Record<string, unknown>;
    /** Aggregated values for this group */
    values: Record<string, number | null>;
  }>;
  /** Total number of groups (for pagination) */
  totalGroups?: number;
}

/**
 * Configuration for which fields can be aggregated.
 */
export interface AggregateConfig {
  /** Fields that can be used with SUM */
  sumFields?: string[];
  /** Fields that can be used with AVG */
  avgFields?: string[];
  /** Fields that can be used with MIN/MAX */
  minMaxFields?: string[];
  /** Fields that can be used with COUNT DISTINCT */
  countDistinctFields?: string[];
  /** Fields that can be used for GROUP BY */
  groupByFields?: string[];
  /** Default limit for grouped results */
  defaultLimit?: number;
  /** Maximum limit for grouped results */
  maxLimit?: number;
}

/**
 * Parse aggregation field from query string.
 * Supports formats like: "count:*", "sum:amount", "avg:price:averagePrice"
 */
export function parseAggregateField(value: string): AggregateField | null {
  const parts = value.split(':');
  if (parts.length < 2) return null;

  const rawOp = parts[0].toLowerCase();
  const validOps = ['count', 'sum', 'avg', 'min', 'max', 'countdistinct'];

  if (!validOps.includes(rawOp)) {
    return null;
  }

  // Normalize countdistinct to countDistinct
  const operation: AggregateOperation = rawOp === 'countdistinct' ? 'countDistinct' : rawOp as AggregateOperation;

  return {
    operation,
    field: parts[1],
    alias: parts[2],
  };
}

/**
 * Parse aggregations from query parameters.
 */
export function parseAggregateQuery(query: Record<string, unknown>): AggregateOptions {
  const aggregations: AggregateField[] = [];
  const filters: Record<string, unknown> = {};

  // Parse individual aggregation params
  const aggParams = ['count', 'sum', 'avg', 'min', 'max', 'countDistinct'];

  for (const op of aggParams) {
    const value = query[op];
    if (value) {
      const fields = Array.isArray(value) ? value : [value];
      for (const field of fields) {
        if (typeof field === 'string') {
          aggregations.push({
            operation: op as AggregateOperation,
            field: field === 'true' || field === '' ? '*' : field,
          });
        }
      }
    }
  }

  // Parse groupBy
  let groupBy: string[] | undefined;
  if (query.groupBy) {
    const groupByValue = query.groupBy;
    if (typeof groupByValue === 'string') {
      groupBy = groupByValue.split(',').map(s => s.trim());
    } else if (Array.isArray(groupByValue)) {
      groupBy = groupByValue.filter(s => typeof s === 'string') as string[];
    }
  }

  // Parse having (format: having[alias][op]=value)
  let having: Record<string, Record<string, unknown>> | undefined;
  for (const [key, value] of Object.entries(query)) {
    const havingMatch = key.match(/^having\[(\w+)\]\[(\w+)\]$/);
    if (havingMatch) {
      const [, alias, op] = havingMatch;
      if (!having) having = {};
      if (!having[alias]) having[alias] = {};
      having[alias][op] = value;
    }
  }

  // Parse orderBy
  const orderBy = typeof query.orderBy === 'string' ? query.orderBy : undefined;
  const orderDirection = query.orderDirection === 'desc' ? 'desc' : 'asc';

  // Parse pagination
  const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined;
  const offset = typeof query.offset === 'string' ? parseInt(query.offset, 10) : undefined;

  // Collect remaining params as filters
  const reservedParams = [...aggParams, 'groupBy', 'orderBy', 'orderDirection', 'limit', 'offset'];
  for (const [key, value] of Object.entries(query)) {
    if (!reservedParams.includes(key) && !key.startsWith('having[')) {
      filters[key] = value;
    }
  }

  return {
    aggregations,
    groupBy,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    having,
    orderBy,
    orderDirection,
    limit,
    offset,
  };
}

// ============================================================================
// Computed Fields Types
// ============================================================================

/**
 * Function that computes a field value from the record data.
 * @template T - The record type
 * @template R - The return type of the computed field
 */
export type ComputedFieldFn<T = Record<string, unknown>, R = unknown> = (
  record: T
) => R | Promise<R>;

/**
 * Configuration for a single computed field.
 */
export interface ComputedFieldConfig<T = Record<string, unknown>, R = unknown> {
  /**
   * Function that computes the field value from the record.
   * Can be sync or async.
   */
  compute: ComputedFieldFn<T, R>;

  /**
   * Zod schema for the computed field (for OpenAPI documentation).
   * If not provided, the field won't appear in OpenAPI schemas.
   */
  schema?: ZodType<R>;

  /**
   * Fields that this computed field depends on.
   * Used for optimization - if none of these fields are selected,
   * the computed field won't be calculated.
   */
  dependsOn?: string[];
}

/**
 * Map of computed field names to their configurations.
 */
export type ComputedFieldsConfig<T = Record<string, unknown>> = Record<
  string,
  ComputedFieldConfig<T, unknown>
>;

/**
 * Apply computed fields to a single record.
 * @param record - The record to add computed fields to
 * @param computedFields - The computed fields configuration
 * @returns The record with computed fields added
 */
export async function applyComputedFields<T extends Record<string, unknown>>(
  record: T,
  computedFields?: ComputedFieldsConfig<T>
): Promise<Record<string, unknown>> {
  if (!computedFields || Object.keys(computedFields).length === 0) {
    return record;
  }

  const result: Record<string, unknown> = { ...record };

  for (const [fieldName, config] of Object.entries(computedFields)) {
    try {
      const value = await config.compute(record);
      result[fieldName] = value;
    } catch (error) {
      // If computation fails, set field to undefined
      result[fieldName] = undefined;
    }
  }

  return result;
}

/**
 * Apply computed fields to an array of records.
 * @param records - The records to add computed fields to
 * @param computedFields - The computed fields configuration
 * @returns The records with computed fields added
 */
export async function applyComputedFieldsToArray<T extends Record<string, unknown>>(
  records: T[],
  computedFields?: ComputedFieldsConfig<T>
): Promise<Array<Record<string, unknown>>> {
  if (!computedFields || Object.keys(computedFields).length === 0) {
    return records;
  }

  return Promise.all(
    records.map((record) => applyComputedFields(record, computedFields))
  );
}

// ============================================================================
// Multi-Tenancy Types
// ============================================================================

/**
 * Configuration for multi-tenant behavior.
 * When enabled, all queries are automatically filtered by tenant ID,
 * and tenant ID is automatically injected on create operations.
 */
export interface MultiTenantConfig {
  /**
   * The field name that stores the tenant ID.
   * @default 'tenantId'
   */
  field?: string;

  /**
   * How to retrieve the tenant ID from the request context.
   * - 'header': From request header (specify headerName)
   * - 'context': From Hono context variable (c.get('tenantId'))
   * - 'path': From URL path parameter
   * - 'custom': Use a custom function
   * @default 'context'
   */
  source?: 'header' | 'context' | 'path' | 'custom';

  /**
   * Header name when source is 'header'.
   * @default 'X-Tenant-ID'
   */
  headerName?: string;

  /**
   * Context variable name when source is 'context'.
   * @default 'tenantId'
   */
  contextKey?: string;

  /**
   * Path parameter name when source is 'path'.
   * @default 'tenantId'
   */
  pathParam?: string;

  /**
   * Custom function to extract tenant ID from context.
   * Only used when source is 'custom'.
   */
  getTenantId?: (ctx: Context) => string | undefined;

  /**
   * Whether to throw an error if tenant ID is missing.
   * When false, requests without tenant ID will fail silently (no results).
   * @default true
   */
  required?: boolean;

  /**
   * Error message when tenant ID is required but missing.
   * @default 'Tenant ID is required'
   */
  errorMessage?: string;
}

// ============================================================================
// Soft Delete Types
// ============================================================================

/**
 * Configuration for soft delete behavior.
 */
export interface SoftDeleteConfig {
  /**
   * The field name that stores the deletion timestamp.
   * @default 'deletedAt'
   */
  field?: string;

  /**
   * Whether to allow querying deleted records via `?withDeleted=true`.
   * @default true
   */
  allowQueryDeleted?: boolean;

  /**
   * Query parameter name to include deleted records.
   * @default 'withDeleted'
   */
  queryParam?: string;
}

// ============================================================================
// Model & Meta Types
// ============================================================================

/**
 * Model definition with strong typing.
 * @template T - The Zod schema type for this model
 * @template TTable - Optional ORM table type (Drizzle Table, Prisma model, etc.)
 */
export interface Model<
  T extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
  TTable = unknown
> {
  /** Database table name */
  tableName: string;
  /** Zod schema for validation and type inference */
  schema: T;
  /** Primary key field names - must be keys of the schema */
  primaryKeys: Array<SchemaKeys<T> & string>;
  /** Optional serializer to transform objects before response */
  serializer?: (obj: z.infer<T>) => unknown;
  /** ORM table reference (Drizzle Table, etc.) */
  table?: TTable;
  /**
   * Enable soft delete for this model.
   * When enabled, delete operations set a timestamp instead of removing records,
   * and queries automatically filter out soft-deleted records.
   *
   * @example
   * ```ts
   * // Simple: use default 'deletedAt' field
   * softDelete: true
   *
   * // Custom field name
   * softDelete: { field: 'removed_at' }
   *
   * // Full configuration
   * softDelete: {
   *   field: 'deletedAt',
   *   allowQueryDeleted: true,
   *   queryParam: 'includeDeleted'
   * }
   * ```
   */
  softDelete?: boolean | SoftDeleteConfig;
  /**
   * Define relations for this model.
   * Relations allow loading nested data via `?include=relationName`.
   *
   * @example
   * ```ts
   * const UserModel = defineModel({
   *   tableName: 'users',
   *   schema: UserSchema,
   *   primaryKeys: ['id'],
   *   relations: {
   *     posts: {
   *       type: 'hasMany',
   *       model: 'posts',
   *       foreignKey: 'authorId',
   *     },
   *     profile: {
   *       type: 'hasOne',
   *       model: 'profiles',
   *       foreignKey: 'userId',
   *     },
   *   },
   * });
   * ```
   */
  relations?: RelationsConfig;

  /**
   * Define computed fields for this model.
   * Computed fields are calculated at runtime and not stored in the database.
   * They are added to the response after the data is fetched.
   *
   * @example
   * ```ts
   * const UserModel = defineModel({
   *   tableName: 'users',
   *   schema: UserSchema,
   *   primaryKeys: ['id'],
   *   computedFields: {
   *     fullName: {
   *       compute: (user) => `${user.firstName} ${user.lastName}`,
   *       schema: z.string(),
   *       dependsOn: ['firstName', 'lastName'],
   *     },
   *     age: {
   *       compute: (user) => {
   *         const birth = new Date(user.birthDate);
   *         const today = new Date();
   *         return today.getFullYear() - birth.getFullYear();
   *       },
   *       schema: z.number(),
   *       dependsOn: ['birthDate'],
   *     },
   *     isActive: {
   *       compute: (user) => user.status === 'active' && user.emailVerified,
   *       schema: z.boolean(),
   *     },
   *   },
   * });
   * ```
   */
  computedFields?: ComputedFieldsConfig<z.infer<T>>;

  /**
   * Configure audit logging for this model.
   * When enabled, all changes are automatically logged.
   *
   * @example
   * ```ts
   * const UserModel = defineModel({
   *   tableName: 'users',
   *   schema: UserSchema,
   *   primaryKeys: ['id'],
   *   audit: {
   *     enabled: true,
   *     actions: ['create', 'update', 'delete'],
   *     excludeFields: ['password', 'refreshToken'],
   *   },
   * });
   * ```
   */
  audit?: AuditConfig;

  /**
   * Configure versioning for this model.
   * When enabled, every update creates a history record.
   *
   * @example
   * ```ts
   * const DocumentModel = defineModel({
   *   tableName: 'documents',
   *   schema: DocumentSchema,
   *   primaryKeys: ['id'],
   *   versioning: {
   *     enabled: true,
   *     field: 'version',           // Version counter field
   *     historyTable: 'documents_history',
   *     maxVersions: 50,            // Keep last 50 versions
   *     trackChangedBy: true,
   *   },
   * });
   * ```
   */
  versioning?: VersioningConfig;

  /**
   * Configure multi-tenancy for this model.
   * When enabled, all queries are automatically filtered by tenant ID,
   * and tenant ID is automatically injected on create operations.
   *
   * @example
   * ```ts
   * // Simple: use default 'tenantId' field from context
   * multiTenant: true
   *
   * // Get tenant from header
   * multiTenant: {
   *   field: 'organizationId',
   *   source: 'header',
   *   headerName: 'X-Organization-ID',
   * }
   *
   * // Get tenant from URL path
   * multiTenant: {
   *   field: 'tenantId',
   *   source: 'path',
   *   pathParam: 'tenantId',
   * }
   *
   * // Custom extraction
   * multiTenant: {
   *   field: 'tenantId',
   *   source: 'custom',
   *   getTenantId: (ctx) => ctx.get('user')?.tenantId,
   * }
   * ```
   */
  multiTenant?: boolean | MultiTenantConfig;
}

/**
 * Meta input configuration for endpoints.
 * @template T - The Zod schema type for the model
 * @template TTable - Optional ORM table type
 */
export interface MetaInput<
  T extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
  TTable = unknown
> {
  /** The model configuration */
  model: Model<T, TTable>;
  /** Override schema fields for request body validation */
  fields?: ZodObject<ZodRawShape>;
  /** URL path parameters (e.g., ['id', 'tenantId']) */
  pathParameters?: string[];
}

/**
 * Helper to create a typed Model configuration.
 * Provides better inference than manually typing the object.
 *
 * @example
 * ```ts
 * const UserSchema = z.object({
 *   id: z.uuid(),
 *   name: z.string(),
 * });
 *
 * const UserModel = defineModel({
 *   tableName: 'users',
 *   schema: UserSchema,
 *   primaryKeys: ['id'],  // Type-checked against schema keys
 * });
 * ```
 */
export function defineModel<
  T extends ZodObject<ZodRawShape>,
  TTable = unknown
>(config: Model<T, TTable>): Model<T, TTable> {
  return config;
}

/**
 * Helper to create a typed MetaInput configuration.
 *
 * @example
 * ```ts
 * const userMeta = defineMeta({
 *   model: UserModel,
 * });
 * ```
 */
export function defineMeta<
  T extends ZodObject<ZodRawShape>,
  TTable = unknown
>(config: MetaInput<T, TTable>): MetaInput<T, TTable> {
  return config;
}

// ============================================================================
// Soft Delete Helpers
// ============================================================================

/**
 * Normalized soft delete configuration with all defaults applied.
 */
export interface NormalizedSoftDeleteConfig {
  enabled: boolean;
  field: string;
  allowQueryDeleted: boolean;
  queryParam: string;
}

/**
 * Get normalized soft delete configuration from a model.
 * Returns a consistent config object with all defaults applied.
 */
export function getSoftDeleteConfig(
  softDelete: boolean | SoftDeleteConfig | undefined
): NormalizedSoftDeleteConfig {
  if (!softDelete) {
    return {
      enabled: false,
      field: 'deletedAt',
      allowQueryDeleted: true,
      queryParam: 'withDeleted',
    };
  }

  if (softDelete === true) {
    return {
      enabled: true,
      field: 'deletedAt',
      allowQueryDeleted: true,
      queryParam: 'withDeleted',
    };
  }

  return {
    enabled: true,
    field: softDelete.field ?? 'deletedAt',
    allowQueryDeleted: softDelete.allowQueryDeleted ?? true,
    queryParam: softDelete.queryParam ?? 'withDeleted',
  };
}

// ============================================================================
// Multi-Tenancy Helpers
// ============================================================================

/**
 * Normalized multi-tenant configuration with all defaults applied.
 */
export interface NormalizedMultiTenantConfig {
  enabled: boolean;
  field: string;
  source: 'header' | 'context' | 'path' | 'custom';
  headerName: string;
  contextKey: string;
  pathParam: string;
  getTenantId?: (ctx: Context) => string | undefined;
  required: boolean;
  errorMessage: string;
}

/**
 * Get normalized multi-tenant configuration from a model.
 * Returns a consistent config object with all defaults applied.
 */
export function getMultiTenantConfig(
  multiTenant: boolean | MultiTenantConfig | undefined
): NormalizedMultiTenantConfig {
  const defaults: NormalizedMultiTenantConfig = {
    enabled: false,
    field: 'tenantId',
    source: 'context',
    headerName: 'X-Tenant-ID',
    contextKey: 'tenantId',
    pathParam: 'tenantId',
    required: true,
    errorMessage: 'Tenant ID is required',
  };

  if (!multiTenant) {
    return defaults;
  }

  if (multiTenant === true) {
    return {
      ...defaults,
      enabled: true,
    };
  }

  return {
    enabled: true,
    field: multiTenant.field ?? defaults.field,
    source: multiTenant.source ?? defaults.source,
    headerName: multiTenant.headerName ?? defaults.headerName,
    contextKey: multiTenant.contextKey ?? defaults.contextKey,
    pathParam: multiTenant.pathParam ?? defaults.pathParam,
    getTenantId: multiTenant.getTenantId,
    required: multiTenant.required ?? defaults.required,
    errorMessage: multiTenant.errorMessage ?? defaults.errorMessage,
  };
}

/**
 * Extract tenant ID from context based on configuration.
 * Returns undefined if tenant ID is not found.
 */
export function extractTenantId(
  ctx: Context,
  config: NormalizedMultiTenantConfig
): string | undefined {
  if (!config.enabled) {
    return undefined;
  }

  switch (config.source) {
    case 'header':
      return ctx.req.header(config.headerName);

    case 'context':
      // Use raw access for compatibility with different Hono typing setups
      return (ctx as unknown as { get: (key: string) => string | undefined }).get(config.contextKey);

    case 'path':
      return ctx.req.param(config.pathParam);

    case 'custom':
      if (config.getTenantId) {
        return config.getTenantId(ctx);
      }
      return undefined;

    default:
      return undefined;
  }
}

// Hook execution modes
export type HookMode = 'sequential' | 'parallel' | 'fire-and-forget';

// Hook function type
export type HookFn<T = unknown, Tx = unknown> = (
  data: T,
  tx?: Tx
) => T | Promise<T> | void | Promise<void>;

// Hook configuration
export interface HookConfig<T = unknown, Tx = unknown> {
  mode: HookMode;
  hooks: Array<HookFn<T, Tx>>;
}

// OpenAPI route schema
export interface OpenAPIRouteSchema {
  request?: RouteConfig['request'];
  responses?: RouteConfig['responses'];
  tags?: string[];
  summary?: string;
  description?: string;
  security?: RouteConfig['security'];
  operationId?: string;
}

// Route options
export interface RouteOptions {
  raiseUnknownParameters?: boolean;
}

// Validated data from request
export interface ValidatedData<T = unknown> {
  body?: T;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

// Response helper types
export interface SuccessResponse<T> {
  success: true;
  result: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Route handler arguments
export type HandleArgs<E extends Env = Env> = [Context<E>];

// ============================================================================
// Search Types
// ============================================================================

/**
 * Search field configuration for a single field.
 */
export interface SearchFieldConfig {
  /** Relevance weight for this field (default: 1.0). Higher values increase importance. */
  weight?: number;
  /** Field type for special handling. 'array' fields will search within array elements. */
  type?: 'text' | 'keyword' | 'array';
}

/**
 * Model-level search configuration.
 */
export interface SearchConfig {
  /** Fields that can be searched with their configurations */
  fields: Record<string, SearchFieldConfig>;
  /** PostgreSQL tsvector column name for native full-text search */
  vectorColumn?: string;
  /** PostgreSQL text search configuration (e.g., 'english', 'simple') */
  vectorConfig?: string;
}

/**
 * Search mode for query matching.
 */
export type SearchMode = 'any' | 'all' | 'phrase';

/**
 * A single search result item with scoring and highlighting.
 */
export interface SearchResultItem<T> {
  /** The matched record */
  item: T;
  /** Relevance score (0-1, higher is better) */
  score: number;
  /** Highlighted field snippets with matched terms wrapped in tags */
  highlights?: Record<string, string[]>;
  /** List of fields that matched the search query */
  matchedFields: string[];
}

/**
 * Search options parsed from query parameters.
 */
export interface SearchOptions {
  /** The search query string */
  query: string;
  /** Fields to search (defaults to all searchable fields) */
  fields?: string[];
  /** Match mode: 'any' (OR), 'all' (AND), or 'phrase' (exact) */
  mode: SearchMode;
  /** Whether to include highlighted snippets in results */
  highlight: boolean;
  /** Minimum relevance score threshold (0-1) */
  minScore: number;
}

/**
 * Search result with pagination info.
 */
export interface SearchResult<T> {
  /** Search result items with scores and highlights */
  items: SearchResultItem<T>[];
  /** Total number of matching records (before pagination) */
  totalCount: number;
}

/**
 * Parse search mode from string.
 */
export function parseSearchMode(value: string | undefined): SearchMode {
  if (value === 'all' || value === 'phrase') {
    return value;
  }
  return 'any';
}

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Infer the TypeScript type from a Model's schema.
 * @example
 * type User = InferModel<typeof UserModel>;
 */
export type InferModel<M extends Model> = z.infer<M['schema']>;

/**
 * Infer the TypeScript type from a MetaInput's model schema.
 * @example
 * type User = InferMeta<typeof userMeta>;
 */
export type InferMeta<M extends MetaInput> = z.infer<M['model']['schema']>;

/**
 * Extract the table type from a Model.
 */
export type ModelTable<M extends Model> = M['table'];

/**
 * Make specific fields of a type optional.
 * Useful for create operations where some fields are auto-generated.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific fields of a type required.
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
