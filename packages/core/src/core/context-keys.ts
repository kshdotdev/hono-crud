/**
 * Central registry of Hono context-variable key strings.
 *
 * Single source of truth for the magic strings used to stash and read
 * per-request data on the Hono context. Writer middleware and the context
 * accessors all reference these constants, so renaming a key happens in one
 * place instead of being hand-edited across every middleware that writes it.
 *
 * The `*Env['Variables']` interfaces (e.g. `AuthEnv`, `ApiVersionEnv`) remain
 * the *type* contract for each key; `CONTEXT_KEYS` is the *value* contract. Because each
 * value is a string literal (via `as const`), `ctx.set(CONTEXT_KEYS.userId, …)` against
 * a typed env is still checked by Hono — you get both type safety and a single
 * source for the key string.
 *
 * Intentionally NOT included:
 * - `RESPONSE_ENVELOPE_CONTEXT_KEY` / `POLICIES_CONTEXT_KEY` — module-private
 *   `Symbol`s, not string keys.
 * - The multi-tenant `config.contextKey` — supplied by the consumer at runtime,
 *   so it is not a fixed key.
 */
export const CONTEXT_KEYS = {
  // --- Auth (written by auth middleware, typed via AuthEnv) ---
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

  // --- Storage registries (written by storage middleware) ---
  auditStorage: 'auditStorage',
  versioningStorage: 'versioningStorage',
  loggingStorage: 'loggingStorage',
  apiKeyStorage: 'apiKeyStorage',
  eventEmitter: 'eventEmitter',
} as const;

/** Union of all known context-variable key strings. */
export type ContextKey = (typeof CONTEXT_KEYS)[keyof typeof CONTEXT_KEYS];
