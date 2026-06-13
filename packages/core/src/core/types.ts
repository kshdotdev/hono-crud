import type { RouteConfig } from '@hono/zod-openapi';
import type { Context, Env } from 'hono';
import { type ZodObject, type ZodRawShape, type ZodType, z } from 'zod';
import { CONTEXT_KEYS } from './context-keys';

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
/**
 * Canonical list of supported filter operators.
 *
 * Single source of truth: both the {@link FilterOperator} union and the runtime
 * guard {@link isFilterOperator} are derived from this `as const` array, so the
 * compile-time type and the runtime membership check can never drift apart.
 */
export const FILTER_OPERATORS = [
  'eq', // equals
  'ne', // not equals
  'gt', // greater than
  'gte', // greater than or equal
  'lt', // less than
  'lte', // less than or equal
  'in', // in array
  'nin', // not in array
  // Cross-adapter substring-match contract (memory/drizzle/prisma must not
  // diverge): the user value is a LITERAL needle — `%` is stripped, `_` is
  // inert, never live SQL wildcards. `like` = substring match whose case
  // behavior follows the database collation in SQL adapters (strict in
  // memory); `ilike` = always case-insensitive substring match.
  'like', // substring match (collation case behavior)
  'ilike', // case-insensitive substring match
  'null', // is null
  'between', // between two values
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type FilterOperatorList = readonly FilterOperator[];

/**
 * Runtime type guard for {@link FilterOperator}.
 *
 * Used to validate operators parsed from untrusted query strings
 * (`field[op]=value`) before they reach an adapter, so an unrecognized operator
 * cannot silently disable a filter and return every row.
 */
export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

/**
 * Compile-time exhaustiveness guard for discriminated unions.
 *
 * Call it from the `default` branch of a `switch` over a closed union: the
 * parameter is typed `never`, so adding a new union member makes every such
 * call fail to compile until the new case is handled — converting a silent
 * fall-through into a build error. If somehow reached at runtime (an invariant
 * was violated), it throws rather than continuing with bad state.
 *
 * @example
 * switch (op) {
 *   case 'a': return 1;
 *   case 'b': return 2;
 *   default: return assertNever(op);
 * }
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${String(value)}`);
}

/**
 * Canonical sort directions. Single source for the {@link SortDirection} type
 * and every `z.enum(SORT_DIRECTIONS)` validator, so the compile-time union and
 * the runtime schemas cannot drift from one another.
 */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * A field + direction sort specification. Names the `{ field, order }` shape
 * that list/search/builder configuration objects share.
 */
export interface SortSpec {
  field: string;
  order: SortDirection;
}

/**
 * Canonical search modes: `any` (OR), `all` (AND), `phrase` (exact). Single
 * source for the {@link SearchMode} type and the `z.enum(SEARCH_MODES)` query
 * validator.
 */
export const SEARCH_MODES = ['any', 'all', 'phrase'] as const;

/**
 * Canonical aggregate operations. Single source for the
 * {@link AggregateOperation} type and the runtime operation lists in
 * `core/aggregate.ts`.
 */
export const AGGREGATE_OPERATIONS = ['count', 'sum', 'avg', 'min', 'max', 'countDistinct'] as const;

// Filter configuration per field
export type FilterConfig = {
  [field: string]: FilterOperatorList;
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
  order_by_direction?: SortDirection;
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
    /**
     * Cursor for fetching the next page (cursor-based pagination).
     * Cursor walks are next-only (Stripe-style); there is no prev_cursor.
     */
    next_cursor?: string;
  };
}

// Cursor codecs (encodeCursor / decodeCursor) moved to ./cursor.ts.

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
  | 'cascade' // Delete related records
  | 'setNull' // Set foreign key to null
  | 'restrict' // Prevent delete if related records exist
  | 'noAction'; // Do nothing (default)

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
  /**
   * ORM table reference for the related model (required for Drizzle).
   * For Prisma, a string naming the related model's client delegate
   * (e.g. `'person'`) — overrides the camelCase+singularize derivation
   * from `model` for irregular names.
   */
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

// Nested-write helpers (extractNestedData / isDirectNestedData) moved to
// ./nested-writes.ts.

// ============================================================================
// Audit Log Types
// ============================================================================

/**
 * Type of operation that was performed.
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'batch_create'
  | 'batch_update'
  | 'batch_delete'
  | 'batch_restore'
  | 'upsert'
  | 'batch_upsert';

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

// Audit helpers (getAuditConfig / calculateChanges) moved to ../audit/config.ts.

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
 * Versioning configuration for a model (stored record-history versions).
 * HTTP API version negotiation is configured separately via `ApiVersioningConfig`
 * (api-version).
 */
export interface VersioningConfig {
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

// Versioning helper (getVersioningConfig) moved to ../versioning/config.ts.

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Supported aggregation operations.
 */
export type AggregateOperation = (typeof AGGREGATE_OPERATIONS)[number];

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
  orderDirection?: SortDirection;
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

// Aggregate parsers (parseAggregateField / parseAggregateQuery) moved to
// ./aggregate.ts.

// ============================================================================
// Computed Fields Types
// ============================================================================

/**
 * Function that computes a field value from the record data.
 * @template T - The record type
 * @template R - The return type of the computed field
 */
export type ComputedFieldFn<T = Record<string, unknown>, R = unknown> = (
  record: T,
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

// Computed-field appliers (applyComputedFields / applyComputedFieldsToArray)
// moved to ./computed-fields.ts.

// ============================================================================
// Multi-Tenancy Types
// ============================================================================

/**
 * Every recognized tenant-ID source across both pipeline stages.
 * Single source of truth: the middleware and the model layer each derive their
 * legal subset via Exclude<> below, so the two sides cannot drift.
 */
export type TenantIdSource = 'header' | 'context' | 'path' | 'query' | 'jwt' | 'custom';

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
   * Where the DATA LAYER reads the tenant ID.
   * - 'header': From request header (specify headerName)
   * - 'context': From Hono context variable (c.get('tenantId'))
   * - 'path': From URL path parameter
   * - 'custom': Use a custom function
   *
   * 'query'/'jwt' are excluded: raw-HTTP extraction belongs to the multiTenant()
   * middleware, which validates and publishes to context — set source 'context'
   * (the default) to consume it.
   * @default 'context'
   */
  source?: Exclude<TenantIdSource, 'query' | 'jwt'>;

  /**
   * Header name when source is 'header'.
   * @default 'X-Tenant-ID'
   */
  headerName?: string;

  /**
   * Context variable the data layer READS when source is 'context'
   * (the middleware's contextKey is where it WRITES).
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
 * Context passed to `Model.resolveSchema` so the resolver can return a
 * tenant-, organization-, or request-specific Zod schema.
 *
 * `request` and `env` come straight from the underlying Hono request when
 * the resolver is invoked at request time. They may be undefined when the
 * resolver is invoked from offline tooling (e.g. per-tenant OpenAPI
 * pre-generation against a `cacheKey`).
 */
export interface SchemaResolveContext {
  tenantId?: string;
  organizationId?: string;
  request?: Request;
  env?: unknown;
  cacheKey?: string;
}

/**
 * Primary-key generation strategy for {@link Model.id}.
 *
 * - `'uuid'` — DEFAULT (also the behavior when `Model.id` is unset):
 *   `crypto.randomUUID()`, byte-identical to the historical behavior.
 * - `'database'` — the adapter omits the PK from the insert payload so the
 *   DB/ORM column default fills it; the generated value is read back via the
 *   adapter's existing RETURNING / create-return. Drizzle + Prisma only;
 *   invalid for the memory adapter.
 * - `() => string | number` — a custom JS generator (ulid / nanoid / ksuid /
 *   snowflake), invoked at every write site by every adapter.
 */
export type IdStrategy = 'uuid' | 'database' | (() => string | number);

/**
 * Model definition with strong typing.
 * @template T - The Zod schema type for this model
 * @template TTable - Optional ORM table type (Drizzle Table, Prisma model, etc.)
 */
export interface Model<
  T extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
  TTable = unknown,
> {
  /** Database table name */
  tableName: string;
  /**
   * Optional OpenAPI tag / API group for this resource.
   *
   * This is the canonical "what API group does this resource belong to"
   * home. It flows into every generated endpoint's
   * `OpenAPIRouteSchema.tags` (and therefore the emitted OpenAPI
   * operations) unless a per-endpoint `openapi.tags` override is set,
   * which always wins. When unset, the effective tag falls back to
   * `tableName`, so consumers that never set explicit tags get stable,
   * resource-grouped documentation by default.
   *
   * @example
   * ```ts
   * defineModel({ tableName: 'users', tag: 'Accounts', schema, primaryKeys: ['id'] });
   * ```
   */
  tag?: string;
  /** Zod schema for validation and type inference */
  schema: T;
  /**
   * Optional per-request schema resolver.
   *
   * When set, the returned schema is used in place of `schema` for body
   * validation and OpenAPI emission for the current request (or the current
   * `buildPerTenantOpenApi(...)` call). The static `schema` is always required
   * and acts as the fallback when no resolver is configured.
   *
   * The resolver is invoked at most once per request per model — results are
   * memoized on the Hono context.
   */
  resolveSchema?: (ctx: SchemaResolveContext) => T | Promise<T>;
  /** Primary key field names - must be keys of the schema */
  primaryKeys: Array<SchemaKeys<T> & string>;
  /** Optional serializer to transform objects before response */
  serializer?: (obj: z.infer<T>) => unknown;
  /**
   * ORM table reference (Drizzle Table, etc.).
   * For Prisma, a string naming the client delegate explicitly
   * (e.g. `defineModel({ tableName: 'people', table: 'person', ... })`) —
   * overrides the camelCase+singularize derivation from `tableName` for
   * irregular names.
   */
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
   * `true` enables with defaults; pass a config object to customize.
   *
   * @example
   * ```ts
   * // Simple: enable with defaults
   * audit: true
   *
   * // Customized
   * const UserModel = defineModel({
   *   tableName: 'users',
   *   schema: UserSchema,
   *   primaryKeys: ['id'],
   *   audit: {
   *     actions: ['create', 'update', 'delete'],
   *     excludeFields: ['password', 'refreshToken'],
   *   },
   * });
   * ```
   */
  audit?: boolean | AuditConfig;

  /**
   * Configure versioning for this model.
   * When enabled, every update creates a history record.
   * `true` enables with defaults; pass a config object to customize.
   *
   * @example
   * ```ts
   * // Simple: enable with defaults
   * versioning: true
   *
   * // Customized
   * const DocumentModel = defineModel({
   *   tableName: 'documents',
   *   schema: DocumentSchema,
   *   primaryKeys: ['id'],
   *   versioning: {
   *     field: 'version',           // Version counter field
   *     historyTable: 'documents_history',
   *     maxVersions: 50,            // Keep last 50 versions
   *     trackChangedBy: true,
   *   },
   * });
   * ```
   */
  versioning?: boolean | VersioningConfig;

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

  /**
   * Configure field-level encryption for this model.
   * Listed fields are encrypted via Web Crypto AES-GCM before write and
   * decrypted automatically before the response (or before computed fields run).
   *
   * @example
   * ```ts
   * fieldEncryption: {
   *   fields: ['ssn', 'taxId'],
   *   keyProvider: new StaticKeyProvider(rawKey),
   * }
   * ```
   */
  fieldEncryption?: import('../encryption/types').FieldEncryptionConfig;

  /**
   * Default serialization profile applied to read/list responses.
   * Use a SerializationProfile to whitelist/blacklist fields per role
   * or to apply field transforms before the response is sent.
   *
   * @example
   * ```ts
   * serializationProfile: profile<User>().exclude('password').build()
   * ```
   */
  serializationProfile?: import('../serialization/types').SerializationProfile;

  /**
   * Optional row-level / field-level policies applied automatically by
   * List, Read, Update, and Delete endpoints. See `ModelPolicies` for the
   * full surface.
   */
  policies?: ModelPolicies<z.infer<T>>;

  /**
   * Primary-key generation strategy. Applied at every write site
   * (create / batchCreate / upsert / clone) when the PK is not supplied
   * by the caller. Member of the engine-managed write-field family
   * alongside `softDelete` / `audit` / `versioning` / `multiTenant`, and
   * enforced uniformly by every adapter.
   *
   * - `'uuid'` (or unset) — `crypto.randomUUID()`, the unchanged historical
   *   default. Fully backward compatible.
   * - `'database'` — the adapter omits the PK from the insert payload so
   *   the DB/ORM column default fills it (Drizzle `$defaultFn`, SQL
   *   `DEFAULT`/sequence, Prisma `@default`); the generated value is read
   *   back via the adapter's existing RETURNING / create-return. Supported
   *   by the drizzle and prisma adapters only — the memory adapter has no
   *   database and throws a `ConfigurationException` at first write.
   * - `() => string | number` — a custom JS generator (ulid / nanoid /
   *   ksuid / snowflake), invoked at every write site by every adapter.
   *
   * @example
   * ```ts
   * import { ulid } from 'ulid';
   * defineModel({ tableName: 'users', schema, primaryKeys: ['id'], id: ulid });
   * defineModel({ tableName: 'orders', schema, primaryKeys: ['id'], id: 'database' });
   * ```
   */
  id?: IdStrategy;

  /**
   * Auto-managed timestamp columns. `true` ⇒ fields named `createdAt`
   * and `updatedAt`. Object form renames either field. Values are epoch
   * milliseconds (`Date.now()`, a `number`), matching the common
   * edge/SQLite-integer convention — schemas using non-numeric timestamp
   * columns (e.g. ISO strings or SQL `timestamp`) should NOT enable this.
   * Unset ⇒ OFF (no stamping — unchanged, fully backward compatible).
   *
   * Enforced uniformly by every adapter:
   * - INSERT paths (create / batchCreate / upsert-insert / clone): when
   *   the field is not explicitly supplied by the caller, both
   *   `createdAt` and `updatedAt` are set to `Date.now()`.
   * - UPDATE paths (update / batchUpdate / upsert-update): `updatedAt` is
   *   ALWAYS set to `Date.now()` (server-managed; any client-supplied
   *   value is ignored). `createdAt` is never touched on update.
   *
   * @example
   * ```ts
   * defineModel({ tableName: 'users', schema, primaryKeys: ['id'], timestamps: true });
   * defineModel({
   *   tableName: 'events', schema, primaryKeys: ['id'],
   *   timestamps: { createdAt: 'created_ms', updatedAt: 'updated_ms' },
   * });
   * ```
   */
  timestamps?: boolean | { createdAt?: string; updatedAt?: string };
}

/**
 * Row-level / field-level access policies for a model. When set on
 * `Model.policies`, the lib applies them automatically in the relevant
 * endpoints — no per-endpoint wiring needed.
 *
 * - `read(ctx, record)` — predicate run after fetch in List/Read. Records
 *   that return false are filtered (List) or yield a 404 (Read, to avoid
 *   leaking existence).
 * - `write(ctx, record)` — predicate run before Update/Delete. Returning
 *   false yields a 403.
 * - `fields(ctx, record)` — returns a partial record to merge over the
 *   raw record on read; use to mask fields (e.g. `{ ssn: undefined }`).
 * - `readPushdown(ctx)` — optional perf opt-in. Returns extra
 *   `FilterCondition[]` AND'd into List queries at the query level so the
 *   adapter never returns rows the policy would have stripped post-fetch.
 *   Useful when the policy is expressible as a WHERE condition (most
 *   tenant-scoped policies are).
 */
export interface ModelPolicies<T = unknown> {
  read?: (ctx: PolicyContext, record: T) => boolean | Promise<boolean>;
  write?: (ctx: PolicyContext, record: T) => boolean | Promise<boolean>;
  fields?: (ctx: PolicyContext, record: T) => Partial<T>;
  readPushdown?: (ctx: PolicyContext) => FilterCondition[];
}

/**
 * Context passed to `ModelPolicies` callbacks. Sourced from the in-flight
 * Hono context — `user` from `c.var.user`, tenant/org from
 * `c.var.tenantId`/`c.var.organizationId`, request from `c.req.raw`.
 */
export interface PolicyContext {
  user?: import('../auth/types').AuthUser;
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  request: Request;
}

/**
 * Meta input configuration for endpoints.
 * @template T - The Zod schema type for the model
 * @template TTable - Optional ORM table type
 */
export interface MetaInput<
  T extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
  TTable = unknown,
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
export function defineModel<T extends ZodObject<ZodRawShape>, TTable = unknown>(
  config: Model<T, TTable>,
): Model<T, TTable> {
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
export function defineMeta<T extends ZodObject<ZodRawShape>, TTable = unknown>(
  config: MetaInput<T, TTable>,
): MetaInput<T, TTable> {
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

// Soft-delete normalizer (getSoftDeleteConfig) moved to ./soft-delete.ts.

// ============================================================================
// Multi-Tenancy Helpers
// ============================================================================

/**
 * Normalized multi-tenant configuration with all defaults applied.
 */
export interface NormalizedMultiTenantConfig {
  enabled: boolean;
  field: string;
  source: Exclude<TenantIdSource, 'query' | 'jwt'>;
  headerName: string;
  contextKey: string;
  pathParam: string;
  getTenantId?: (ctx: Context) => string | undefined;
  required: boolean;
  errorMessage: string;
}

// Multi-tenant helpers (getMultiTenantConfig / extractTenantId) moved to
// ../multi-tenant/config.ts.

/**
 * Context passed to lifecycle hooks (`before`/`after` on Create/Update/Delete
 * endpoints). Carries the underlying transaction handle (when the adapter
 * wraps in one) plus the request-scoped tenancy and actor identifiers, so
 * hooks can do work that participates in the same tx as the parent write
 * and observes the same tenant/agent context.
 *
 * `db.tx` is the adapter-specific transaction handle. For Drizzle it's the
 * Drizzle transaction (when `useTransaction === true`). For the in-memory
 * adapter it's a no-op sentinel. Throwing inside an `after*` hook only
 * rolls back the parent write when the adapter is operating inside a real
 * transaction AND `afterHookMode === 'sequential'`. The default
 * `fire-and-forget` mode runs after the response is sent and cannot
 * trigger rollback — opt into `sequential` to get rollback semantics.
 */
export interface HookContext {
  /** Adapter-specific transaction handle (Drizzle tx, Prisma client, sentinel for memory). */
  db: { tx: unknown };
  /** The underlying Hono request, when available. */
  request?: Request;
  /** Tenant identifier as resolved by the multi-tenant middleware. */
  tenantId?: string;
  /** Organization identifier from `c.var.organizationId`. */
  organizationId?: string;
  /** Authenticated user identifier from `c.var.userId`. */
  userId?: string;
  /** Optional agent identifier (set by upstream agent middleware). */
  agentId?: string;
  /** Optional agent run identifier (set by upstream agent middleware). */
  agentRunId?: string;
}

// Hook execution modes
export type HookMode = 'sequential' | 'parallel' | 'fire-and-forget';

// Hook function type
export type HookFn<T = unknown, Tx = unknown> = (
  data: T,
  tx?: Tx,
) => T | Promise<T> | void | Promise<void>;

// Hook configuration
export interface HookConfig<T = unknown, Tx = unknown> {
  mode: HookMode;
  hooks: Array<HookFn<T, Tx>>;
}

/**
 * Signature for the `after`/`afterUpdate` hook on Update endpoints.
 *
 * Receives the **pre-mutation** row as `prior` plus the post-mutation row as
 * `current`, both observed inside the same DB transaction as the parent
 * UPDATE (when the adapter wraps in one). The two-snapshot shape lets
 * downstream consumers compute field-level diffs server-side — audit logs,
 * change-data-capture payloads, event bodies — without a re-fetch in
 * `before` and without a separate read after the mutation that would race
 * concurrent writers.
 *
 * Returning a value replaces the row used for the response and downstream
 * after-actions (events, audit, computed fields). Returning `void`
 * preserves `current` unchanged.
 *
 * Throwing inside this hook rolls back the parent UPDATE only when
 * `afterHookMode === 'sequential'` AND the adapter wraps in a real
 * transaction. See `HookContext.db.tx`.
 */
export type AfterUpdateHook<T = unknown> = (
  prior: T,
  current: T,
  ctx: HookContext,
) => Promise<void | T> | void | T;

/**
 * Signature for the `after`/`afterDelete` hook on Delete endpoints.
 *
 * Receives the **pre-mutation** row as `prior`, observed inside the same
 * DB transaction as the parent DELETE (when the adapter wraps in one).
 * For soft-delete, `prior` is the row as it existed before `deletedAt`
 * was set — i.e. with `deletedAt: null` (or whatever the configured
 * field's null-state is).
 *
 * The pre-mutation snapshot lets diff-based audit/CDC pipelines emit a
 * full payload of the row that just disappeared, instead of the bare id.
 *
 * Throwing inside this hook rolls back the parent DELETE only when
 * `afterHookMode === 'sequential'` AND the adapter wraps in a real
 * transaction. See `HookContext.db.tx`.
 */
export type AfterDeleteHook<T = unknown> = (prior: T, ctx: HookContext) => Promise<void> | void;

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

/**
 * Canonical schema for a single validation issue carried in the `details`
 * array of a 400 `VALIDATION_ERROR` envelope, as produced by
 * `InputValidationException.fromZodError(...)` (`path` is the dot-joined
 * Zod issue path).
 */
export const validationIssueSchema = z.object({
  /** Dot-joined path to the failing field (`'address.city'`). */
  path: z.string(),
  /** Human-readable issue message. */
  message: z.string(),
  /** Zod issue code (`'invalid_type'`, `'too_small'`, …). */
  code: z.string(),
});

/** A single validation issue (see {@link validationIssueSchema}). */
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/**
 * Canonical schema for the structured error object passed to
 * `ResponseEnvelope.error` — the single source of truth for the
 * `{ code, message, details?, … }` shape produced by `ApiException.toJSON()`,
 * emitted in OpenAPI 4xx/5xx responses, and reused by middleware that returns
 * the standard error envelope (e.g. idempotency). `.passthrough()` keeps the
 * shape open for forward-compatible enrichment.
 */
export const structuredErrorSchema = z
  .object({
    /** Stable error code (`'NOT_FOUND'`, `'VALIDATION_ERROR'`, …). */
    code: z.string(),
    /** Human-readable error message. */
    message: z.string(),
    /** Optional structured details (validation issues, conflict info, etc.). */
    details: z.unknown().optional(),
    /** Request id, if logging middleware is active and surfacing it. */
    requestId: z.string().optional(),
    /** Stack trace, if `includeStackTrace` is enabled (development only!). */
    stack: z.string().optional(),
  })
  .passthrough();

/**
 * Canonical schema for the standard error response envelope
 * (`{ success: false, error: <structuredError> }`).
 */
export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: structuredErrorSchema,
});

/**
 * Build the matching success envelope schema (`{ success: true, result }`) for
 * a given result schema. Pairs with {@link errorEnvelopeSchema} so both halves
 * of the response contract come from one place.
 */
export function successEnvelopeSchema<T extends ZodType>(
  result: T,
): ZodObject<{ success: ZodType; result: T }> {
  return z.object({ success: z.literal(true), result }) as unknown as ZodObject<{
    success: ZodType;
    result: T;
  }>;
}

/**
 * Standardised structured error object passed to `ResponseEnvelope.error`.
 *
 * Derived from {@link structuredErrorSchema}; the `[key: string]: unknown`
 * intersection preserves the open shape (`.passthrough()`) for custom envelopes
 * that format it into RFC 7807, JSON:API, a house standard, etc.
 */
export type StructuredError = z.infer<typeof structuredErrorSchema> & {
  [key: string]: unknown;
};

/**
 * Standard error response envelope. Derived from {@link errorEnvelopeSchema}.
 */
export type ErrorResponse = z.infer<typeof errorEnvelopeSchema>;

/**
 * Pagination metadata shape passed to `ResponseEnvelope.success` for list
 * and search responses. Mirrors `PaginatedResult.result_info` so envelope
 * authors don't have to re-import the wider type.
 */
export type ResponseEnvelopeInfo =
  | PaginatedResult<unknown>['result_info']
  | Record<string, unknown>;

/**
 * Pluggable response envelope. When provided on `RegisterCrudOptions` (or
 * resolved off the request context), the two functions are the **final
 * formatting step** before the response body is serialised.
 *
 * - `success(result, info?)` is invoked for every 2xx CRUD response. `info`
 *   is the pagination metadata for list/search endpoints; `undefined` for
 *   single-item responses (read/create/update/delete/etc.).
 * - `error(err)` is invoked for every error response. Composition order:
 *   any `ErrorMapper`s registered on `createErrorHandler` run **first** and
 *   transform the raw `Error` into a `StructuredError`; the envelope's
 *   `error()` then wraps that structured object into the final response
 *   body. This means consumers can keep their existing mappers (e.g.
 *   Prisma `P2002` → `ConflictException`) and layer a custom envelope on
 *   top.
 *
 * Default behaviour (when no envelope is configured) is byte-identical to
 * pre-0.10.0 — `{ success: true, result, result_info? }` for success and
 * `{ success: false, error: <StructuredError> }` for errors.
 *
 * @example RFC 7807 Problem Details
 * ```ts
 * const envelope: ResponseEnvelope = {
 *   success: (result, info) => info ? { data: result, meta: info } : { data: result },
 *   error: (err) => ({
 *     type: `https://example.com/errors/${err.code}`,
 *     title: err.message,
 *     status: err.details ? 422 : 400,
 *     detail: err.message,
 *     instance: err.requestId,
 *   }),
 * };
 * ```
 */
export interface ResponseEnvelope {
  /**
   * Format a successful CRUD response body.
   * @param result - The endpoint's result payload (single item, array, or batch object).
   * @param info - Pagination metadata for list/search responses; undefined otherwise.
   */
  success: (result: unknown, info?: ResponseEnvelopeInfo) => unknown;
  /**
   * Format an error response body. Receives the `StructuredError` produced
   * by `ApiException.toJSON()` after any `ErrorMapper`s have run.
   */
  error: (err: StructuredError) => unknown;
}

/**
 * Hono context-var key under which the active `ResponseEnvelope` is
 * stashed by `registerCrud(...)` and read by `OpenAPIRoute.success` /
 * `createErrorHandler`. Internal — exported for adapter authors who need
 * to read the same envelope from custom endpoints.
 */
export const RESPONSE_ENVELOPE_CONTEXT_KEY = CONTEXT_KEYS.responseEnvelope;

/**
 * Read the per-request {@link ResponseEnvelope} stashed on the Hono context by
 * `registerCrud(...)`'s envelope middleware.
 *
 * The context `var` bag is untyped at this boundary (it carries arbitrary
 * per-request values), so the single unavoidable cast is localized here instead
 * of being repeated — previously as `(ctx as unknown as { var?: … })?.var?.[…]
 * as ResponseEnvelope` — at every read site (`OpenAPIRoute.getResponseEnvelope`,
 * the OpenAPI error path, and `resolveErrorEnvelope`). Accepts an `unknown`
 * context (including `undefined`) and returns `undefined` when no envelope is set.
 */
export function readResponseEnvelope(ctx: unknown): ResponseEnvelope | undefined {
  const vars = (ctx as { var?: Record<string, unknown> } | null | undefined)?.var;
  return vars?.[RESPONSE_ENVELOPE_CONTEXT_KEY] as ResponseEnvelope | undefined;
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
 * Search mode for query matching. Derived from {@link SEARCH_MODES}.
 */
export type SearchMode = (typeof SEARCH_MODES)[number];

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
  /**
   * Total number of matching records before pagination.
   *
   * For adapters whose initial candidate set is a SQL `LIKE` (or similar)
   * filter and which then apply in-memory tokenization / scoring / minScore
   * on top, this field is the raw SQL hit count. Set
   * {@link SearchResult.postFilteredCount} to the post-filter count so that
   * the public `result_info.total_count` reflects what the client actually
   * receives. Without `postFilteredCount`, `total_count` falls back to
   * `totalCount` (back-compatible).
   */
  totalCount: number;
  /**
   * Optional: number of records that survived BOTH the adapter's initial
   * candidate filter (e.g. SQL LIKE) and any in-memory post-filtering
   * (tokenization, stopword removal, minScore). Adapters that perform
   * such post-filtering should populate this so that
   * `result_info.total_count` matches the user-visible result set and
   * pagination math is correct. When omitted, the handler falls back to
   * `totalCount`.
   */
  postFilteredCount?: number;
}

// Search-mode parser (parseSearchMode) moved to ../endpoints/search-utils.ts.

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

/**
 * Constructor type for classes. Used in mixin patterns (withCache, withAuth, etc.).
 */
export type Constructor<T = object> = new (...args: unknown[]) => T;
