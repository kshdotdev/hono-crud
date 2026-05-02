// ============================================================================
// Type Exports
// ============================================================================

export type {
  // User types
  AuthUser,
  AuthType,
  AuthEnv,
  // JWT types
  JWTAlgorithm,
  JWTClaims,
  JWTConfig,
  ValidatedJWTClaims,
  // API Key types
  APIKeyEntry,
  APIKeyLookupResult,
  APIKeyConfig,
  // Auth config types
  PathPattern,
  AuthConfig,
  // Guard types
  AuthorizationCheck,
  OwnershipExtractor,
  Guard,
  // Endpoint types
  EndpointAuthConfig,
} from './types';

export {
  // JWT claims validation
  JWTClaimsSchema,
  parseJWTClaims,
  safeParseJWTClaims,
} from './types';

// ============================================================================
// Middleware Exports
// ============================================================================

// JWT middleware
export { createJWTMiddleware, verifyJWT, decodeJWT } from './middleware/jwt';

// API Key middleware
export {
  createAPIKeyMiddleware,
  validateAPIKey,
  defaultHashAPIKey,
} from './middleware/api-key';

// Combined middleware
export {
  createAuthMiddleware,
  optionalAuth,
  requireAuthentication,
} from './middleware/combined';

// ============================================================================
// Guard Exports
// ============================================================================

export {
  // Role guards
  requireRoles,
  requireAllRoles,
  // Permission guards
  requirePermissions,
  requireAnyPermission,
  // Custom guards
  requireAuth,
  requireOwnership,
  requireOwnershipOrRole,
  // Guard composition
  allOf,
  anyOf,
  // Utility guards
  denyAll,
  allowAll,
  requireAuthenticated,
  // Policy guard (row-level / field-level — Model.policies)
  requirePolicy,
  POLICIES_CONTEXT_KEY,
  // Approval guard (Human-in-the-Loop deferred execution)
  requireApproval,
} from './guards';

// Approval storage
export { MemoryApprovalStorage } from './storage/approval-memory';
export { parseIso8601Duration } from './utils/duration';

// ============================================================================
// Approval Type Exports
// ============================================================================

export type {
  ApprovalConfig,
  ApprovalStorage,
  PendingAction,
  PendingActionStatus,
  ActionSource,
} from './types';

// ============================================================================
// Endpoint Exports
// ============================================================================

export { AuthenticatedEndpoint, withAuth } from './endpoint';
export type { AuthEndpointMethods } from './endpoint';

// ============================================================================
// Storage Exports
// ============================================================================

export {
  MemoryAPIKeyStorage,
  generateAPIKey,
  hashAPIKey,
  isValidAPIKeyFormat,
  getAPIKeyStorage,
  setAPIKeyStorage,
} from './storage/memory';

// ============================================================================
// Validator Exports
// ============================================================================

export { validateJWTClaims } from './validators/jwt-claims';
export type { JWTClaimsValidationOptions } from './validators/jwt-claims';

export { validateAPIKeyEntry } from './validators/api-key';
