import type { Env, Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

// ============================================================================
// User Types
// ============================================================================

/**
 * User information stored in context after authentication.
 */
export interface AuthUser {
  /** Unique user identifier */
  id: string;
  /** User's email address */
  email?: string;
  /** User's assigned roles (e.g., ['admin', 'moderator']) */
  roles?: string[];
  /** User's permissions (e.g., ['users:read', 'users:write']) */
  permissions?: string[];
  /** Additional user metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Type of authentication used.
 */
export type AuthType = 'jwt' | 'api-key' | 'none';

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Hono environment variables for authentication.
 * Extend your app's Env with this for type-safe context access.
 *
 * @example
 * ```ts
 * const app = new Hono<AuthEnv>();
 * app.get('/me', (c) => {
 *   const userId = c.var.userId; // string | undefined
 *   const user = c.var.user;     // AuthUser | undefined
 * });
 * ```
 */
export interface AuthEnv extends Env {
  Variables: {
    /** Authenticated user's ID */
    userId?: string;
    /** Full user object */
    user?: AuthUser;
    /** User's roles (convenience copy from user.roles) */
    roles?: string[];
    /** User's permissions (convenience copy from user.permissions) */
    permissions?: string[];
    /** Type of authentication that was used */
    authType?: AuthType;
  };
}

// ============================================================================
// JWT Configuration
// ============================================================================

/**
 * Supported JWT signing algorithms.
 */
export type JWTAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';

/**
 * Standard JWT claims.
 */
export interface JWTClaims {
  /** Subject (typically user ID) */
  sub?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Not before time (Unix timestamp) */
  nbf?: number;
  /** Issued at time (Unix timestamp) */
  iat?: number;
  /** JWT ID */
  jti?: string;
  /** Custom claims */
  [key: string]: unknown;
}

/**
 * Zod schema for validating JWT claims at runtime.
 * Uses passthrough() to allow custom claims while validating standard ones.
 *
 * @example
 * ```ts
 * import { JWTClaimsSchema } from 'hono-crud';
 *
 * // Parse and validate claims
 * const result = JWTClaimsSchema.safeParse(decodedPayload);
 * if (!result.success) {
 *   throw new UnauthorizedException('Invalid token payload');
 * }
 * const claims = result.data;
 * ```
 */
export const JWTClaimsSchema = z
  .object({
    /** Subject (typically user ID) */
    sub: z.string().optional(),
    /** Issuer */
    iss: z.string().optional(),
    /** Audience - can be string or array of strings */
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    /** Expiration time (Unix timestamp) */
    exp: z.number().int().optional(),
    /** Not before time (Unix timestamp) */
    nbf: z.number().int().optional(),
    /** Issued at time (Unix timestamp) */
    iat: z.number().int().optional(),
    /** JWT ID */
    jti: z.string().optional(),
  })
  .passthrough();

/**
 * Type inferred from JWTClaimsSchema.
 * Equivalent to JWTClaims but derived from Zod schema.
 */
export type ValidatedJWTClaims = z.infer<typeof JWTClaimsSchema>;

/**
 * Validates JWT claims using the Zod schema.
 * Throws an error with details if validation fails.
 *
 * @param claims - The claims object to validate
 * @returns The validated claims
 * @throws Error with validation details if invalid
 *
 * @example
 * ```ts
 * try {
 *   const validated = parseJWTClaims(decodedPayload);
 *   console.log('Subject:', validated.sub);
 * } catch (e) {
 *   console.error('Invalid claims:', e.message);
 * }
 * ```
 */
export function parseJWTClaims(claims: unknown): ValidatedJWTClaims {
  return JWTClaimsSchema.parse(claims);
}

/**
 * Safely validates JWT claims using the Zod schema.
 * Returns a result object instead of throwing.
 *
 * @param claims - The claims object to validate
 * @returns A SafeParseResult with success status and data or error
 *
 * @example
 * ```ts
 * const result = safeParseJWTClaims(decodedPayload);
 * if (result.success) {
 *   console.log('Subject:', result.data.sub);
 * } else {
 *   console.error('Validation errors:', result.error.issues);
 * }
 * ```
 */
export function safeParseJWTClaims(claims: unknown): z.ZodSafeParseResult<ValidatedJWTClaims> {
  return JWTClaimsSchema.safeParse(claims);
}

/**
 * Configuration for JWT authentication middleware.
 */
export interface JWTConfig {
  /**
   * Secret key for HMAC algorithms (HS256, HS384, HS512).
   * For RSA/ECDSA, provide the public key.
   */
  secret: string | CryptoKey;

  /**
   * Algorithm used for signing.
   * @default 'HS256'
   */
  algorithm?: JWTAlgorithm;

  /**
   * Expected issuer claim (iss).
   * If provided, tokens with different issuers are rejected.
   */
  issuer?: string;

  /**
   * Expected audience claim (aud).
   * If provided, tokens must include this audience.
   */
  audience?: string | string[];

  /**
   * Clock tolerance in seconds for exp/nbf validation.
   * @default 0
   */
  clockTolerance?: number;

  /**
   * Custom function to extract user info from JWT claims.
   * @default Extracts sub as id, and copies email, roles, permissions
   */
  extractUser?: (claims: JWTClaims) => AuthUser;

  /**
   * Custom function to extract the token from the request.
   * @default Extracts from Authorization: Bearer <token> header
   */
  extractToken?: (ctx: Context) => string | null;
}

// ============================================================================
// API Key Configuration
// ============================================================================

/**
 * Entry stored for an API key.
 */
export interface APIKeyEntry {
  /** Unique ID of this API key */
  id: string;
  /** Hash of the API key (never store raw keys) */
  keyHash: string;
  /** User ID this key belongs to */
  userId: string;
  /** Display name for this key */
  name?: string;
  /** User's roles when using this key */
  roles?: string[];
  /** User's permissions when using this key */
  permissions?: string[];
  /** When this key expires (null = never) */
  expiresAt?: Date | null;
  /** Whether this key is active */
  active: boolean;
  /** When this key was created */
  createdAt: Date;
  /** When this key was last used */
  lastUsedAt?: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of looking up an API key.
 */
export type APIKeyLookupResult = APIKeyEntry | null;

/**
 * Storage backend for API keys. Implement this to plug in a custom
 * persistence layer (Redis, D1, Postgres, …).
 */
export interface APIKeyStorage {
  /** Persist an API key entry. */
  store(entry: APIKeyEntry): Promise<void>;
  /** Look up an entry by its SHA-256 hash. */
  lookup(keyHash: string): Promise<APIKeyLookupResult>;
  /** Look up an entry by its id. */
  getById(id: string): Promise<APIKeyLookupResult>;
  /** Get all entries belonging to a user. */
  getByUserId(userId: string): Promise<APIKeyEntry[]>;
  /** Mark an entry inactive. Returns true if the entry existed. */
  revoke(id: string): Promise<boolean>;
  /** Permanently remove an entry. Returns true if the entry existed. */
  delete(id: string): Promise<boolean>;
  /** Update the lastUsedAt timestamp for an entry. */
  updateLastUsed(id: string): Promise<void>;
}

/**
 * Configuration for API key authentication middleware.
 */
export interface APIKeyConfig {
  /**
   * Header name to extract API key from.
   * @default 'X-API-Key'
   */
  headerName?: string;

  /**
   * Query parameter name to extract API key from (fallback).
   * Set to null to disable query parameter extraction.
   * @default null
   */
  queryParam?: string | null;

  /**
   * Function to look up an API key by its hash.
   * Return null if the key is not found.
   */
  lookupKey: (keyHash: string) => Promise<APIKeyLookupResult> | APIKeyLookupResult;

  /**
   * Function to hash an API key.
   * @default SHA-256 hash
   */
  hashKey?: (key: string) => Promise<string> | string;

  /**
   * Function to update last used timestamp (fire-and-forget).
   * Called after successful authentication.
   */
  updateLastUsed?: (keyId: string) => void | Promise<void>;

  /**
   * Custom function to extract user info from API key entry.
   * @default Uses userId, roles, permissions, and metadata from entry
   */
  extractUser?: (entry: APIKeyEntry) => AuthUser;
}

// ============================================================================
// Combined Auth Configuration
// ============================================================================

/**
 * Path matching pattern.
 * Supports:
 * - Exact paths: '/health'
 * - Wildcards: '/docs/*', '/public/**'
 * - Regex: /^\/api\/v[0-9]+\//
 */
export type PathPattern = string | RegExp;

/**
 * Configuration for combined authentication middleware.
 */
export interface AuthConfig {
  /**
   * JWT authentication configuration.
   * If not provided, JWT auth is disabled.
   */
  jwt?: JWTConfig;

  /**
   * API key authentication configuration.
   * If not provided, API key auth is disabled.
   */
  apiKey?: APIKeyConfig;

  /**
   * Whether authentication is required.
   * If false, unauthenticated requests are allowed but user info is still
   * extracted if present.
   * @default true
   */
  requireAuth?: boolean;

  /**
   * Paths that skip authentication entirely.
   * These paths won't have any auth processing.
   * @default []
   */
  skipPaths?: PathPattern[];

  /**
   * Custom error message for unauthorized requests.
   * @default 'Unauthorized'
   */
  unauthorizedMessage?: string;

  /**
   * Try authentication methods in order.
   * @default ['jwt', 'api-key']
   */
  authOrder?: AuthType[];
}

// ============================================================================
// Guard Types
// ============================================================================

/**
 * Custom authorization check function.
 * Return true to allow access, false to deny.
 */
export type AuthorizationCheck<E extends AuthEnv = AuthEnv> = (
  user: AuthUser,
  ctx: Context<E>
) => boolean | Promise<boolean>;

/**
 * Function to extract owner ID from a request.
 * Used for ownership-based authorization.
 */
export type OwnershipExtractor<E extends AuthEnv = AuthEnv> = (
  ctx: Context<E>
) => string | Promise<string>;

/**
 * A guard is a middleware that checks authorization.
 */
export type Guard<E extends AuthEnv = AuthEnv> = MiddlewareHandler<E>;

// ============================================================================
// Endpoint Auth Configuration
// ============================================================================

/**
 * Authentication requirements for an endpoint.
 */
export interface EndpointAuthConfig {
  /**
   * Whether this endpoint requires authentication.
   * @default true
   */
  requiresAuth?: boolean;

  /**
   * Required roles (user must have at least one).
   */
  requiredRoles?: string[];

  /**
   * Required permissions (user must have all).
   */
  requiredPermissions?: string[];

  /**
   * Whether all roles are required (AND logic) vs any role (OR logic).
   * @default false (OR logic)
   */
  requireAllRoles?: boolean;

  /**
   * Custom authorization check.
   */
  authorize?: AuthorizationCheck;
}

// ============================================================================
// Approval (Human-in-the-Loop deferred execution)
// ============================================================================

/**
 * Origin of an action that triggered an approval request. Distinguishes
 * "human user via HTTP" from "agent acting on behalf of a user via MCP",
 * etc., so audit logs and approver UIs can render the right context.
 */
export type ActionSource =
  | 'http'
  | 'agent-mcp'
  | 'agent-code-mode'
  | 'workflow'
  | 'job'
  | 'system';

/**
 * Lifecycle state of a pending action.
 */
export type PendingActionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * A deferred-execution record written by `requireApproval(...)` on the
 * first call. The middleware looks it up on the resume call (when the
 * client re-invokes the same handler with `body[resumeMarker] = id`),
 * verifies status === 'approved' AND not expired, then replays the
 * original `input` into the handler.
 *
 * Carries full actor identity so audit logs can distinguish human vs.
 * agent vs. agent-on-behalf-of-user.
 */
export interface PendingAction {
  /** Unique ID, UUID v4 (Web Crypto). */
  id: string;
  /** Tenant scope, when the request was tenant-scoped. */
  tenantId?: string;
  /** Organization scope. */
  organizationId?: string;
  /** Convenience copy of `actorUserId`. */
  userId?: string;
  /** The human user who *initiated* the action (or null for system). */
  actorUserId?: string;
  /** When an agent runs on behalf of a user, the user it represents. */
  onBehalfOfUserId?: string;
  /** Identifier of the agent that produced the action, when applicable. */
  agentId?: string;
  /** Identifier of the agent-run / conversation, when applicable. */
  agentRunId?: string;
  /** MCP tool-call identifier, when the action came through MCP. */
  toolCallId?: string;
  /** Origin of the action (HTTP, agent, workflow, …). */
  source: ActionSource;
  /** Endpoint or tool name being approved. */
  toolName: string;
  /**
   * Original request input (typed `unknown` because it varies per tool —
   * `requireApproval` doesn't constrain it). Replayed verbatim on resume.
   */
  input: unknown;
  /** Lifecycle state. */
  status: PendingActionStatus;
  /** ISO 8601 — when the request was logged. */
  createdAt: string;
  /** ISO 8601 — when the request expires. After this it should not be replayed. */
  expiresAt: string;
  /** Reason shown to the approver. */
  reason: string;
  /** Identifier of the user who approved (if any). */
  approvedBy?: string;
  /** ISO 8601 — when the action was approved. */
  approvedAt?: string;
  /** Identifier of the user who rejected (if any). */
  rejectedBy?: string;
  /** Reason given for rejection. */
  rejectedReason?: string;
}

/**
 * Pluggable storage interface for pending actions. Ship a Memory backend
 * for prototyping; downstream consumers provide their own
 * Postgres / D1 / Durable Object backed implementation.
 */
export interface ApprovalStorage {
  /** Persist a freshly-created PendingAction. */
  create(action: PendingAction): Promise<void>;
  /** Look up a PendingAction by id. Returns null if missing OR expired. */
  get(actionId: string): Promise<PendingAction | null>;
  /** Mark approved. Throws / rejects if the action is missing or terminal. */
  approve(actionId: string, by: string): Promise<void>;
  /** Mark rejected with a reason. */
  reject(actionId: string, by: string, reason: string): Promise<void>;
}

/**
 * Configuration for `requireApproval(...)`.
 */
export interface ApprovalConfig {
  /** Reason text shown to the approver in the inbox UI. */
  reason: string;
  /** ISO 8601 duration string (e.g. `'P1D'`, `'PT2H'`). @default 'P1D' */
  expiresAfter?: string;
  /** Storage backend. @default `new MemoryApprovalStorage()` */
  approvalStorage?: ApprovalStorage;
  /**
   * Body field whose presence flags a resume call. The value is the
   * actionId to look up. @default '_resume_'
   */
  resumeMarker?: string;
  /**
   * Optional human-readable name for the action (defaults to the request
   * method + path). Surfaces on `PendingAction.toolName`.
   */
  toolName?: string;
}
