/**
 * Public root barrel — owns the CRUD core only.
 *
 * Feature families (auth, logging, storage, events, serialization, encryption,
 * api-version, audit, versioning, multi-tenant, functional, builder, config,
 * health, cloudflare) live exclusively on their `hono-crud/<feature>` subpaths.
 * This barrel never exports renamed aliases.
 */

// Combined environment type
import type { AuthEnv } from './auth/types';
import type { LoggingEnv } from './logging/types';
import type { StorageEnv } from './storage/types';

/** Combined environment type with all hono-crud context variables */
export type HonoCrudEnv = AuthEnv & LoggingEnv & StorageEnv;

// Core exports
export { OpenAPIRoute, isRouteClass } from './core/route';
export { fromHono, HonoOpenAPIHandler } from './core/openapi';
export type { OpenAPIConfig, RouterOptions, RegisteredRoute } from './core/openapi';
export { buildPerTenantOpenApi, wrapCacheStorageForOpenApi } from './openapi/lazy';
export type {
  PerTenantOpenApiCache,
  PerTenantOpenApiOptions,
} from './openapi/lazy';
export { toOpenApiPaths } from './openapi/paths';
export type { OpenApiPathItem, ToOpenApiPathsOptions } from './openapi/paths';
export {
  ApiException,
  InputValidationException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  AggregationException,
  CacheException,
  ConfigurationException,
} from './core/exceptions';
export {
  createErrorHandler,
  zodErrorMapper,
  resolveErrorEnvelope,
} from './core/error-handler';
export type {
  ErrorMapper,
  ErrorHook,
  ErrorHandlerConfig,
} from './core/error-handler';
export {
  getTimestampsConfig,
  getManagedInputExclusions,
  applyManagedInsertFields,
  applyManagedUpdateFields,
  assertIdStrategySupported,
  stripManagedInsertFields,
  mapUniqueViolation,
  causeChain,
  rethrowAsConstraintError,
} from './core/managed-fields';
export type {
  AdapterKind,
  NormalizedTimestampsConfig,
} from './core/managed-fields';
export {
  defineModel,
  defineMeta,
  RESPONSE_ENVELOPE_CONTEXT_KEY,
  FILTER_OPERATORS,
  isFilterOperator,
  assertNever,
  SORT_DIRECTIONS,
  SEARCH_MODES,
  AGGREGATE_OPERATIONS,
  validationIssueSchema,
  structuredErrorSchema,
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from './core/types';
export { encodeCursor, decodeCursor } from './core/cursor';
export { applyComputedFields, applyComputedFieldsToArray } from './core/computed-fields';
export { extractNestedData, isDirectNestedData } from './core/nested-writes';
export { parseAggregateField, parseAggregateQuery } from './core/aggregate';
export { applyUpsertRestore, getSoftDeleteConfig } from './core/soft-delete';
export { parseSearchMode } from './endpoints/search-utils';
export type {
  FilterOperator,
  FilterConfig,
  FilterCondition,
  SortDirection,
  SortSpec,
  ListOptions,
  ListFilters,
  PaginatedResult,
  Model,
  MetaInput,
  IdStrategy,
  SoftDeleteConfig,
  NormalizedSoftDeleteConfig,
  TenantIdSource,
  MultiTenantConfig,
  NormalizedMultiTenantConfig,
  RelationType,
  RelationConfig,
  RelationsConfig,
  IncludeOptions,
  CascadeAction,
  CascadeConfig,
  NestedWriteConfig,
  NestedWritesConfig,
  NestedCreateOneInput,
  NestedCreateManyInput,
  NestedUpdateInput,
  NestedWriteResult,
  ComputedFieldFn,
  ComputedFieldConfig,
  ComputedFieldsConfig,
  AuditAction,
  AuditFieldChange,
  AuditLogEntry,
  AuditConfig,
  NormalizedAuditConfig,
  VersionHistoryEntry,
  VersioningConfig,
  NormalizedVersioningConfig,
  AggregateOperation,
  AggregateField,
  AggregateOptions,
  AggregateResult,
  AggregateConfig,
  HookMode,
  HookFn,
  HookConfig,
  HookContext,
  AfterUpdateHook,
  AfterDeleteHook,
  ResponseEnvelope,
  ResponseEnvelopeInfo,
  StructuredError,
  ValidationIssue,
  SchemaResolveContext,
  ModelPolicies,
  PolicyContext,
  OpenAPIRouteSchema,
  RouteOptions,
  ValidatedData,
  SuccessResponse,
  ErrorResponse,
  HandleArgs,
  InferModel,
  InferMeta,
  InferSchema,
  SchemaKeys,
  ModelTable,
  PartialBy,
  RequiredBy,
  // Search types
  SearchFieldConfig,
  SearchConfig,
  SearchMode,
  SearchResultItem,
  SearchOptions,
  SearchResult,
} from './core/types';

// Logger exports
export { setLogger, getLogger } from './core/logger';
export type { Logger } from './core/logger';

// ETag exports
export { generateETag, matchesIfNoneMatch, matchesIfMatch } from './utils/etag';

// Endpoint exports
export { CreateEndpoint } from './endpoints/create';
export { ReadEndpoint } from './endpoints/read';
export { UpdateEndpoint } from './endpoints/update';
export { DeleteEndpoint } from './endpoints/delete';
export type { CascadeResult } from './endpoints/delete';
export { ListEndpoint } from './endpoints/list';
export { CloneEndpoint } from './endpoints/clone';
export { createSubscribeHandler } from './endpoints/subscribe';
export type { SubscribeEndpointConfig } from './endpoints/subscribe';
export { RestoreEndpoint } from './endpoints/restore';
export { UpsertEndpoint } from './endpoints/upsert';
export type { UpsertResult } from './endpoints/upsert';
export { BatchCreateEndpoint } from './endpoints/batch-create';
export { BatchUpdateEndpoint } from './endpoints/batch-update';
export type { BatchUpdateItem, BatchUpdateResult } from './endpoints/batch-update';
export { BatchDeleteEndpoint } from './endpoints/batch-delete';
export type { BatchDeleteResult } from './endpoints/batch-delete';
export { BatchRestoreEndpoint } from './endpoints/batch-restore';
export type { BatchRestoreResult } from './endpoints/batch-restore';
export { BatchUpsertEndpoint } from './endpoints/batch-upsert';
export type { BatchUpsertItemResult, BatchUpsertResult } from './endpoints/batch-upsert';
export { BulkPatchEndpoint } from './endpoints/bulk-patch';
export type { BulkPatchResult } from './endpoints/bulk-patch';
export {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from './endpoints/version-history';
export { AggregateEndpoint, computeAggregations } from './endpoints/aggregate';
export { SearchEndpoint, searchInMemory } from './endpoints/search';
export { ExportEndpoint } from './endpoints/export';
export type {
  ExportFormat,
  ExportOptions,
  ExportResult,
} from './endpoints/export';
export { ImportEndpoint } from './endpoints/import';
export type {
  ImportMode,
  ImportRowStatus,
  ImportRowResult,
  ImportSummary,
  ImportResult,
  ImportOptions,
} from './endpoints/import';
export {
  tokenize,
  tokenizeQuery,
  termFrequency,
  calculateScore,
  generateHighlights,
  parseSearchFields,
  buildSearchConfig,
} from './endpoints/search-utils';
export {
  parseFilterValue,
  parseListFilters,
  getSchemaFields,
  parseFieldSelection,
  applyFieldSelection,
  applyFieldSelectionToArray,
} from './endpoints/types';
export type {
  ListFilterParseOptions,
  SingleEndpointConfig,
  UpdateEndpointConfig,
  ModelObject,
  FieldSelectionConfig,
  FieldSelection,
} from './endpoints/types';

// Utility exports
export { registerCrud, contentJson } from './core/register';
export type {
  CrudEndpoints,
  EndpointClass,
  HonoOpenAPIApp,
  CrudEndpointName,
  EndpointMiddlewares,
  RegisterCrudOptions,
} from './core/register';

// CSV utility exports
export {
  escapeCsvValue,
  generateCsv,
  createCsvStream,
  parseCsv,
  validateCsvHeaders,
  inferCsvContentType,
  jsonToCsv,
  csvToJson,
} from './utils/csv';
export type {
  CsvGenerateOptions,
  CsvParseOptions,
  CsvParseResult,
  CsvParseError,
  CsvValidationResult,
} from './utils/csv';

// Error utility exports
export {
  toError,
  wrapError,
  getErrorMessage,
} from './utils/error-coerce';

// Context helper exports — generic accessors from utils/context. The
// auth-flavored accessor family (getUser, hasRole, …) lives on 'hono-crud/auth'.
export {
  getContextVar,
  setContextVar,
  getTenantId,
  getRequestId,
  generateRequestId,
} from './utils/context';

// OpenAPI utilities
export {
  jsonContent,
  jsonContentRequired,
  openApiValidationHook,
  createValidationHook,
} from './openapi/utils';
export type { InferZodSchema } from './openapi/utils';
export {
  errorResponseZodSchema,
  errorResponseSchema,
  errorResponses,
} from './endpoints/responses';

// Context-var key registry (single source of truth for context-var keys)
export { CONTEXT_KEYS } from './core/context-keys';
export type { ContextKey } from './core/context-keys';

// Config-Based API. The endpoint-config TYPES live canonically on
// 'hono-crud/config'; only the function is part of the CRUD core.
export { defineEndpoints } from './config/index';
