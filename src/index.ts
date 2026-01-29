// Combined environment type
import type { AuthEnv } from './auth/types.js';
import type { LoggingEnv } from './logging/types.js';
import type { RateLimitEnv } from './rate-limit/types.js';
import type { StorageEnv } from './storage/types.js';

/** Combined environment type with all hono-crud context variables */
export type HonoCrudEnv = AuthEnv & LoggingEnv & RateLimitEnv & StorageEnv;

// Core exports
export { OpenAPIRoute, isRouteClass } from './core/route.js';
export { fromHono, HonoOpenAPIHandler } from './core/openapi.js';
export type { OpenAPIConfig, RouterOptions } from './core/openapi.js';
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
} from './core/exceptions.js';
export {
  createErrorHandler,
  zodErrorMapper,
} from './core/error-handler.js';
export type {
  ErrorMapper,
  ErrorHook,
  ErrorHandlerConfig,
} from './core/error-handler.js';
export {
  AuditLogger,
  MemoryAuditLogStorage,
  createAuditLogger,
  setAuditStorage,
  getAuditStorage,
} from './core/audit.js';
export type { AuditLogStorage } from './core/audit.js';
export {
  VersionManager,
  MemoryVersioningStorage,
  createVersionManager,
  setVersioningStorage,
  getVersioningStorage,
} from './core/versioning.js';
export type { VersioningStorage } from './core/versioning.js';
export {
  defineModel,
  defineMeta,
  getSoftDeleteConfig,
  applyComputedFields,
  applyComputedFieldsToArray,
  extractNestedData,
  isDirectNestedData,
  getAuditConfig,
  calculateChanges,
  getVersioningConfig,
  parseAggregateField,
  parseAggregateQuery,
  parseSearchMode,
  getMultiTenantConfig,
  extractTenantId,
} from './core/types.js';
export { multiTenant } from './core/multi-tenant.js';
export type {
  MultiTenantMiddlewareOptions,
  TenantEnv,
} from './core/multi-tenant.js';
export type {
  FilterOperator,
  FilterConfig,
  FilterCondition,
  ListOptions,
  ListFilters,
  PaginatedResult,
  Model,
  MetaInput,
  SoftDeleteConfig,
  NormalizedSoftDeleteConfig,
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
} from './core/types.js';

// Endpoint exports
export { CreateEndpoint } from './endpoints/create.js';
export { ReadEndpoint } from './endpoints/read.js';
export { UpdateEndpoint } from './endpoints/update.js';
export { DeleteEndpoint } from './endpoints/delete.js';
export type { CascadeResult } from './endpoints/delete.js';
export { ListEndpoint } from './endpoints/list.js';
export { RestoreEndpoint } from './endpoints/restore.js';
export { UpsertEndpoint } from './endpoints/upsert.js';
export type { UpsertResult } from './endpoints/upsert.js';
export { BatchCreateEndpoint } from './endpoints/batch-create.js';
export { BatchUpdateEndpoint } from './endpoints/batch-update.js';
export type { BatchUpdateItem, BatchUpdateResult } from './endpoints/batch-update.js';
export { BatchDeleteEndpoint } from './endpoints/batch-delete.js';
export type { BatchDeleteResult } from './endpoints/batch-delete.js';
export { BatchRestoreEndpoint } from './endpoints/batch-restore.js';
export type { BatchRestoreResult } from './endpoints/batch-restore.js';
export { BatchUpsertEndpoint } from './endpoints/batch-upsert.js';
export type { BatchUpsertItemResult, BatchUpsertResult } from './endpoints/batch-upsert.js';
export {
  VersionHistoryEndpoint,
  VersionReadEndpoint,
  VersionCompareEndpoint,
  VersionRollbackEndpoint,
} from './endpoints/version-history.js';
export { AggregateEndpoint, computeAggregations } from './endpoints/aggregate.js';
export { SearchEndpoint, searchInMemory } from './endpoints/search.js';
export { ExportEndpoint } from './endpoints/export.js';
export type {
  ExportFormat,
  ExportOptions,
  ExportResult,
} from './endpoints/export.js';
export { ImportEndpoint } from './endpoints/import.js';
export type {
  ImportMode,
  ImportRowStatus,
  ImportRowResult,
  ImportSummary,
  ImportResult,
  ImportOptions,
} from './endpoints/import.js';
export {
  tokenize,
  tokenizeQuery,
  termFrequency,
  calculateScore,
  generateHighlights,
  parseSearchFields,
  buildSearchConfig,
} from './endpoints/search-utils.js';
export {
  parseFilterValue,
  parseListFilters,
  getSchemaFields,
  parseFieldSelection,
  applyFieldSelection,
  applyFieldSelectionToArray,
} from './endpoints/types.js';
export type {
  ListEndpointConfig,
  SingleEndpointConfig,
  UpdateEndpointConfig,
  ModelObject,
  FieldSelectionConfig,
  FieldSelection,
} from './endpoints/types.js';

// Utility exports
export { registerCrud, contentJson, successResponse, errorResponse } from './utils.js';
export type { CrudEndpoints, EndpointClass, HonoOpenAPIApp } from './utils.js';

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
} from './utils/csv.js';
export type {
  CsvGenerateOptions,
  CsvParseOptions,
  CsvParseResult,
  CsvParseError,
  CsvValidationResult,
} from './utils/csv.js';

// Error utility exports
export {
  toError,
  wrapError,
  getErrorMessage,
} from './utils/errors.js';

// Context helper exports
export {
  getContextVar,
  setContextVar,
  getUserId,
  getUser,
  getUserRoles,
  getUserPermissions,
  getAuthType,
  getTenantId,
  getRequestId as getContextRequestId,
  hasRole,
  hasPermission,
  hasAllRoles,
  hasAnyRole,
  hasAllPermissions,
} from './core/context-helpers.js';

// UI exports (Swagger UI, ReDoc, Scalar)
export { setupSwaggerUI, setupReDoc, setupDocs, setupDocsIndex } from './ui.js';
export type { UIOptions } from './ui.js';
export { scalarUI, setupScalar } from './ui/scalar.js';
export type { ScalarConfig, ScalarTheme } from './ui/scalar.js';

// OpenAPI utilities
export {
  jsonContent,
  jsonContentRequired,
  createErrorSchema,
  createOneOfErrorSchema,
  openApiValidationHook,
  createValidationHook,
  httpErrorContent,
  commonResponses,
  ZodIssueSchema,
  ZodErrorSchema,
  HttpErrorSchema,
} from './openapi/utils.js';
export type { ValidationHookResult, InferZodSchema } from './openapi/utils.js';

// Auth exports
export {
  // Middleware
  createJWTMiddleware,
  verifyJWT,
  decodeJWT,
  createAPIKeyMiddleware,
  validateAPIKey,
  defaultHashAPIKey,
  createAuthMiddleware,
  optionalAuth,
  requireAuthentication,
  // Guards
  requireRoles,
  requireAllRoles,
  requirePermissions,
  requireAnyPermission,
  requireAuth,
  requireOwnership,
  requireOwnershipOrRole,
  allOf,
  anyOf,
  denyAll,
  allowAll,
  requireAuthenticated,
  // Endpoint
  AuthenticatedEndpoint,
  withAuth,
  // Storage
  MemoryAPIKeyStorage,
  generateAPIKey,
  hashAPIKey,
  isValidAPIKeyFormat,
  getAPIKeyStorage,
  setAPIKeyStorage,
  // Validators
  validateJWTClaims,
  validateAPIKeyEntry,
  // JWT Claims Schema
  JWTClaimsSchema,
  parseJWTClaims,
  safeParseJWTClaims,
} from './auth/index.js';
export type {
  AuthUser,
  AuthType,
  AuthEnv,
  JWTAlgorithm,
  JWTClaims,
  JWTConfig,
  ValidatedJWTClaims,
  APIKeyEntry,
  APIKeyLookupResult,
  APIKeyConfig,
  PathPattern,
  AuthConfig,
  AuthorizationCheck,
  OwnershipExtractor,
  Guard,
  EndpointAuthConfig,
  AuthEndpointMethods,
  JWTClaimsValidationOptions,
} from './auth/index.js';

// Cache exports
export {
  // Mixins
  withCache,
  withCacheInvalidation,
  // Storage management
  setCacheStorage,
  getCacheStorage,
  // Storage implementations
  MemoryCacheStorage,
  RedisCacheStorage,
  // Key generation utilities
  generateCacheKey,
  createInvalidationPattern,
  createRelatedPatterns,
  matchesPattern,
  parseCacheKey,
} from './cache/index.js';
export type {
  CacheEntry,
  CacheConfig,
  CacheSetOptions,
  CacheStorage,
  CacheStats,
  InvalidationStrategy,
  CacheInvalidationConfig,
  CacheKeyOptions,
  InvalidationPatternOptions,
  RedisClient,
  RedisCacheStorageOptions,
  CacheEndpointMethods,
  CacheInvalidationMethods,
} from './cache/index.js';

// Rate limit exports
export {
  // Middleware
  createRateLimitMiddleware,
  setRateLimitStorage,
  getRateLimitStorage,
  resetRateLimit,
  // Exception
  RateLimitExceededException,
  // Utilities
  extractIP,
  extractUserId,
  extractAPIKey,
  matchPath,
  shouldSkipPath,
  generateKey,
  // Storage implementations
  MemoryRateLimitStorage,
  RedisRateLimitStorage,
} from './rate-limit/index.js';
export type {
  FixedWindowEntry,
  SlidingWindowEntry,
  RateLimitEntry,
  RateLimitStorage,
  RateLimitResult,
  KeyStrategy,
  KeyExtractor,
  RateLimitAlgorithm,
  RateLimitTier,
  TierFunction,
  OnRateLimitExceeded,
  PathPattern as RateLimitPathPattern,
  RateLimitConfig,
  RateLimitEnv,
  MemoryRateLimitStorageOptions,
  RedisRateLimitClient,
  RedisRateLimitStorageOptions,
} from './rate-limit/index.js';

// Logging exports
export {
  // Middleware
  createLoggingMiddleware,
  setLoggingStorage,
  getLoggingStorage,
  getRequestId,
  getRequestStartTime,
  // Utilities
  shouldRedact,
  redactObject,
  redactHeaders,
  matchPath as matchLoggingPath,
  shouldExcludePath,
  extractClientIp,
  extractHeaders,
  extractQuery,
  extractUserId as extractLoggingUserId,
  truncateBody,
  isAllowedContentType,
  generateRequestId,
  // Storage implementations
  MemoryLoggingStorage,
} from './logging/index.js';
export type {
  LogLevel,
  RequestLogEntry,
  ResponseLogEntry,
  LogEntry,
  LogQueryOptions,
  LoggingStorage,
  PathPattern as LoggingPathPattern,
  RedactField,
  RequestBodyConfig,
  ResponseBodyConfig,
  LoggingConfig,
  LoggingEnv,
  MemoryLoggingStorageOptions,
} from './logging/index.js';

// Storage exports (context-based storage management)
export {
  // Middleware
  createStorageMiddleware,
  createRateLimitStorageMiddleware,
  createLoggingStorageMiddleware,
  createCacheStorageMiddleware,
  createAuditStorageMiddleware,
  createVersioningStorageMiddleware,
  createAPIKeyStorageMiddleware,
  // Helpers
  resolveRateLimitStorage,
  resolveLoggingStorage,
  resolveCacheStorage,
  resolveAuditStorage,
  resolveVersioningStorage,
  resolveAPIKeyStorage,
  // Registry
  StorageRegistry,
  createNullableRegistry,
  createRegistryWithDefault,
} from './storage/index.js';
export type {
  StorageEnv,
  StorageMiddlewareConfig,
} from './storage/index.js';
