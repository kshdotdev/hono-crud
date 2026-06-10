/**
 * Central registry of Hono context-variable key strings.
 *
 * Single source of truth for the magic strings used to stash and read
 * per-request data on the Hono context. Writer middleware and the context
 * accessors all reference these constants.
 *
 * The `*Env['Variables']` interfaces remain the *type* contract for each key;
 * `CONTEXT_KEYS` is the *value* contract. Because each value is a string literal
 * (via `as const`), `ctx.set(CONTEXT_KEYS.userId, …)` against a typed env is
 * still checked by Hono.
 *
 * `responseEnvelope` / `policies` are registered here even though their string
 * values are not equal to their keys (they preserve the existing
 * `'__honoCrudResponseEnvelope__'` / `'__honoCrudPolicies'` literals so
 * already-written context data keeps reading). They are exported plain string
 * consts (NOT Symbols); `RESPONSE_ENVELOPE_CONTEXT_KEY` / `POLICIES_CONTEXT_KEY`
 * now alias these entries.
 *
 * Intentionally NOT included:
 * - The multi-tenant `config.contextKey` — supplied by the consumer at runtime,
 *   so it is not a fixed key.
 */
export const CONTEXT_KEYS = {
  // --- Auth ---
  userId: 'userId',
  user: 'user',
  roles: 'roles',
  permissions: 'permissions',
  authType: 'authType',
  jwtPayload: 'jwtPayload',

  // --- Actor / agent attribution ---
  organizationId: 'organizationId',
  agentId: 'agentId',
  agentRunId: 'agentRunId',
  onBehalfOfUserId: 'onBehalfOfUserId',
  toolCallId: 'toolCallId',
  actionSource: 'actionSource',

  // --- Multi-tenant ---
  tenantId: 'tenantId',

  // --- Request lifecycle (logging) ---
  requestId: 'requestId',
  requestStartTime: 'requestStartTime',

  // --- API versioning ---
  apiVersion: 'apiVersion',
  apiVersionConfig: 'apiVersionConfig',

  // --- Database (read by drizzle getDrizzleDb) ---
  db: 'db',

  // --- Storage registries (written by createStorageMiddleware) ---
  loggingStorage: 'loggingStorage',
  auditStorage: 'auditStorage',
  versioningStorage: 'versioningStorage',
  apiKeyStorage: 'apiKeyStorage',
  cacheStorage: 'cacheStorage',
  rateLimitStorage: 'rateLimitStorage',
  idempotencyStorage: 'idempotencyStorage',
  eventEmitter: 'eventEmitter',

  // --- Rate-limit output (written by rate-limit middleware) ---
  rateLimit: 'rateLimit',
  rateLimitKey: 'rateLimitKey',

  // --- Response envelope / policies (plain string consts; value ≠ key) ---
  responseEnvelope: '__honoCrudResponseEnvelope__',
  policies: '__honoCrudPolicies',
} as const;

/** Union of all known context-variable key strings. */
export type ContextKey = (typeof CONTEXT_KEYS)[keyof typeof CONTEXT_KEYS];
