// Combined environment type
import type { AuthEnv } from './auth/types';
import type { LoggingEnv } from './logging/types';
import type { RateLimitEnv } from './rate-limit/types';
import type { StorageEnv } from './storage/types';

/** Combined environment type with all hono-crud context variables */
export type HonoCrudEnv = AuthEnv & LoggingEnv & RateLimitEnv & StorageEnv;

// Core exports
export { OpenAPIRoute, isRouteClass } from './core/route';
export { fromHono, HonoOpenAPIHandler } from './core/openapi';
export type { OpenAPIConfig, RouterOptions } from './core/openapi';
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
} from './core/error-handler';
export type {
  ErrorMapper,
  ErrorHook,
  ErrorHandlerConfig,
} from './core/error-handler';
export {
  AuditLogger,
  MemoryAuditLogStorage,
  createAuditLogger,
  setAuditStorage,
  getAuditStorage,
} from './core/audit';
export type { AuditLogStorage } from './core/audit';
export {
  VersionManager,
  MemoryVersioningStorage,
  createVersionManager,
  setVersioningStorage,
  getVersioningStorage,
} from './core/versioning';
export type { VersioningStorage } from './core/versioning';
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
  encodeCursor,
  decodeCursor,
} from './core/types';
export { multiTenant } from './core/multi-tenant';
export type {
  MultiTenantMiddlewareOptions,
  TenantEnv,
} from './core/multi-tenant';
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
} from './core/types';

// Logger exports
export { setLogger, getLogger } from './core/logger';
export type { Logger } from './core/logger';

// ETag exports
export { generateETag, matchesIfNoneMatch, matchesIfMatch } from './core/etag';

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
  ListEndpointConfig,
  SingleEndpointConfig,
  UpdateEndpointConfig,
  ModelObject,
  FieldSelectionConfig,
  FieldSelection,
} from './endpoints/types';

// Utility exports
export { registerCrud, contentJson, successResponse, errorResponse } from './utils';
export type {
  CrudEndpoints,
  EndpointClass,
  HonoOpenAPIApp,
  CrudEndpointName,
  EndpointMiddlewares,
  RegisterCrudOptions,
} from './utils';

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
} from './utils/errors';

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
} from './core/context-helpers';

// UI exports (Swagger UI, ReDoc, Scalar)
export { setupSwaggerUI, setupReDoc, setupDocs, setupDocsIndex } from './ui';
export type { UIOptions } from './ui';
export { scalarUI, setupScalar } from './ui/scalar';
export type { ScalarConfig, ScalarTheme } from './ui/scalar';

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
} from './openapi/utils';
export type { ValidationHookResult, InferZodSchema } from './openapi/utils';

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
} from './auth/index';
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
} from './auth/index';

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
} from './cache/index';
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
} from './cache/index';

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
} from './rate-limit/index';
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
} from './rate-limit/index';

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
} from './logging/index';
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
} from './logging/index';

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
} from './storage/index';
export type {
  StorageEnv,
  StorageMiddlewareConfig,
} from './storage/index';

// Event system exports
export {
  CrudEventEmitter,
  getEventEmitter,
  setEventEmitter,
  registerWebhooks,
} from './events/index';
export type {
  CrudEventType,
  CrudEventPayload,
  CrudEventListener,
  EventSubscription,
  WebhookEndpoint,
  WebhookConfig,
  WebhookDeliveryResult,
} from './events/index';

// Idempotency exports
export {
  idempotency,
  setIdempotencyStorage,
  getIdempotencyStorage,
  MemoryIdempotencyStorage,
} from './idempotency/index';
export type {
  IdempotencyConfig,
  IdempotencyStorage,
  IdempotencyEntry,
} from './idempotency/index';

// Health check exports
export { createHealthEndpoints, createHealthHandler } from './health/index';
export type {
  HealthCheck,
  HealthCheckFn,
  HealthCheckResult,
  HealthConfig,
  HealthResponse,
} from './health/index';

// Serialization profile exports
export {
  applyProfile,
  applyProfileToArray,
  resolveProfile,
  createSerializer,
  createArraySerializer,
} from './serialization/index';
export type {
  SerializationProfile,
  SerializationConfig,
} from './serialization/index';

// Encryption exports
export {
  encryptValue,
  decryptValue,
  isEncryptedValue,
  encryptFields,
  decryptFields,
  StaticKeyProvider,
} from './encryption/index';
export type {
  EncryptionKeyProvider,
  FieldEncryptionConfig,
  EncryptedValue,
} from './encryption/index';

// API versioning exports
export {
  apiVersion,
  getApiVersion,
  getApiVersionConfig,
  versionedResponse,
} from './api-version/index';
export type {
  VersionStrategy,
  VersionTransformer,
  ApiVersionConfig,
  VersioningMiddlewareConfig,
  ApiVersionEnv,
} from './api-version/index';

// ============================================================================
// Alternative API Patterns
// ============================================================================

// Functional API
export {
  createCreate,
  createList,
  createRead,
  createUpdate,
  createDelete,
} from './functional/index';
export type {
  CreateConfig,
  ListConfig,
  ReadConfig,
  UpdateConfig,
  DeleteConfig,
} from './functional/index';

// Builder/Fluent API
export {
  crud,
  CrudBuilder,
  CreateBuilder,
  ListBuilder,
  ReadBuilder,
  UpdateBuilder,
  DeleteBuilder,
} from './builder/index';

// Config-Based API
export {
  defineEndpoints,
  MemoryAdapters,
} from './config/index';
export type {
  CreateEndpointConfig as ConfigCreateEndpoint,
  ListEndpointConfig as ConfigListEndpoint,
  ReadEndpointConfig as ConfigReadEndpoint,
  UpdateEndpointConfig as ConfigUpdateEndpoint,
  DeleteEndpointConfig as ConfigDeleteEndpoint,
  EndpointsConfig,
  AdapterBundle,
  GeneratedEndpoints,
} from './config/index';
