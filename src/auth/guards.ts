import type { MiddlewareHandler } from 'hono';
import type {
  AuthEnv,
  AuthorizationCheck,
  OwnershipExtractor,
  Guard,
  ApprovalConfig,
  ApprovalStorage,
  PendingAction,
  ActionSource,
} from './types';
import { ForbiddenException, UnauthorizedException } from '../core/exceptions';
import { getContextVar, setContextVar } from '../utils/context';
import type { ModelPolicies } from '../core/types';
import { parseIso8601Duration } from './utils/duration';

/**
 * Storage key under `c.var` for the policies object set by `requirePolicy`.
 * Endpoints prefer this over `Model.policies` when present so route-scoped
 * policies override the model-level defaults.
 */
export const POLICIES_CONTEXT_KEY = '__honoCrudPolicies';

// ============================================================================
// Role Guards
// ============================================================================

/**
 * Creates a guard that requires the user to have at least one of the specified roles.
 *
 * @example
 * ```ts
 * app.use('/admin/*', requireRoles('admin', 'super-admin'));
 * ```
 */
export function requireRoles<E extends AuthEnv = AuthEnv>(
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRoles = user.roles || [];
    const hasRole = roles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to have ALL of the specified roles.
 *
 * @example
 * ```ts
 * app.use('/super/*', requireAllRoles('admin', 'verified'));
 * ```
 */
export function requireAllRoles<E extends AuthEnv = AuthEnv>(
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRoles = user.roles || [];
    const hasAllRoles = roles.every((role) => userRoles.includes(role));

    if (!hasAllRoles) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await next();
  };
}

// ============================================================================
// Permission Guards
// ============================================================================

/**
 * Creates a guard that requires the user to have ALL of the specified permissions.
 *
 * @example
 * ```ts
 * app.use('/users/*', requirePermissions('users:read', 'users:write'));
 * ```
 */
export function requirePermissions<E extends AuthEnv = AuthEnv>(
  ...permissions: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userPermissions = user.permissions || [];
    const hasAllPermissions = permissions.every((perm) => userPermissions.includes(perm));

    if (!hasAllPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to have at least one of the specified permissions.
 *
 * @example
 * ```ts
 * app.use('/data/*', requireAnyPermission('data:read', 'data:admin'));
 * ```
 */
export function requireAnyPermission<E extends AuthEnv = AuthEnv>(
  ...permissions: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const userPermissions = user.permissions || [];
    const hasAnyPermission = permissions.some((perm) => userPermissions.includes(perm));

    if (!hasAnyPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await next();
  };
}

// ============================================================================
// Custom Authorization Guards
// ============================================================================

/**
 * Creates a guard with a custom authorization check.
 *
 * @example
 * ```ts
 * app.use('/premium/*', requireAuth((user, ctx) => {
 *   return user.metadata?.subscription === 'premium';
 * }));
 * ```
 */
export function requireAuth<E extends AuthEnv = AuthEnv>(
  check: AuthorizationCheck<E>
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const isAuthorized = await check(user, ctx);
    if (!isAuthorized) {
      throw new ForbiddenException('Access denied');
    }

    await next();
  };
}

/**
 * Creates a guard that requires the user to own the resource.
 *
 * @example
 * ```ts
 * // Get owner ID from path params
 * app.use('/users/:id/*', requireOwnership((ctx) => ctx.req.param('id')));
 *
 * // Get owner ID from fetched resource
 * app.use('/posts/:id/*', requireOwnership(async (ctx) => {
 *   const post = await db.posts.findUnique({ where: { id: ctx.req.param('id') } });
 *   return post?.authorId || '';
 * }));
 * ```
 */
export function requireOwnership<E extends AuthEnv = AuthEnv>(
  getOwnerId: OwnershipExtractor<E>
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const ownerId = await getOwnerId(ctx);
    if (user.id !== ownerId) {
      throw new ForbiddenException('Access denied: not resource owner');
    }

    await next();
  };
}

/**
 * Creates a guard that allows access if the user owns the resource OR has admin role.
 *
 * @example
 * ```ts
 * app.use('/posts/:id/*', requireOwnershipOrRole(
 *   (ctx) => getPostAuthorId(ctx.req.param('id')),
 *   'admin'
 * ));
 * ```
 */
export function requireOwnershipOrRole<E extends AuthEnv = AuthEnv>(
  getOwnerId: OwnershipExtractor<E>,
  ...roles: string[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    const user = ctx.var.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if user has required role
    const userRoles = user.roles || [];
    const hasRole = roles.some((role) => userRoles.includes(role));

    if (hasRole) {
      await next();
      return;
    }

    // Check if user is owner
    const ownerId = await getOwnerId(ctx);
    if (user.id === ownerId) {
      await next();
      return;
    }

    throw new ForbiddenException('Access denied');
  };
}

// ============================================================================
// Guard Composition
// ============================================================================

/**
 * Creates a guard that requires ALL of the provided guards to pass (AND logic).
 *
 * @example
 * ```ts
 * app.use('/secure/*', allOf(
 *   requireRoles('admin'),
 *   requirePermissions('secure:access'),
 *   requireAuth((user) => user.metadata?.mfaEnabled === true)
 * ));
 * ```
 */
export function allOf<E extends AuthEnv = AuthEnv>(
  ...guards: Guard<E>[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    // Run all guards - if any throws, the request is rejected
    for (const guard of guards) {
      await guard(ctx, async () => {});
    }
    await next();
  };
}

/**
 * Creates a guard that requires ANY of the provided guards to pass (OR logic).
 *
 * @example
 * ```ts
 * app.use('/shared/*', anyOf(
 *   requireRoles('admin'),
 *   requireOwnership((ctx) => getResourceOwnerId(ctx)),
 *   requirePermissions('shared:access')
 * ));
 * ```
 */
export function anyOf<E extends AuthEnv = AuthEnv>(
  ...guards: Guard<E>[]
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    let lastError: Error | null = null;

    for (const guard of guards) {
      try {
        await guard(ctx, async () => {});
        // If any guard passes, allow the request
        await next();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // All guards failed
    if (lastError) {
      throw lastError;
    }
    throw new ForbiddenException('Access denied');
  };
}

// ============================================================================
// Utility Guards
// ============================================================================

/**
 * Creates a guard that denies access to everyone.
 * Useful for temporarily blocking routes.
 *
 * @example
 * ```ts
 * app.use('/maintenance/*', denyAll('Service temporarily unavailable'));
 * ```
 */
export function denyAll<E extends AuthEnv = AuthEnv>(
  message: string = 'Access denied'
): MiddlewareHandler<E> {
  return async () => {
    throw new ForbiddenException(message);
  };
}

/**
 * Creates a guard that allows access to everyone.
 * Useful for explicitly marking public routes.
 *
 * @example
 * ```ts
 * app.use('/public/*', allowAll());
 * ```
 */
export function allowAll<E extends AuthEnv = AuthEnv>(): MiddlewareHandler<E> {
  return async (_ctx, next) => {
    await next();
  };
}

/**
 * Creates a guard that only allows authenticated users.
 * Unlike other guards, this doesn't check roles or permissions.
 *
 * @example
 * ```ts
 * app.use('/api/*', requireAuthenticated());
 * ```
 */
export function requireAuthenticated<E extends AuthEnv = AuthEnv>(): MiddlewareHandler<E> {
  return async (ctx, next) => {
    if (!ctx.var.user) {
      throw new UnauthorizedException('Authentication required');
    }
    await next();
  };
}

// ============================================================================
// Policy Guard (row-level / field-level)
// ============================================================================

/**
 * Attach a `ModelPolicies<T>` object to the current request so the
 * downstream List / Read / Update / Delete endpoints apply it on top of
 * (or in place of) any `Model.policies` defaults.
 *
 * Mutating: writes to `ctx.var[POLICIES_CONTEXT_KEY]`. Does not enforce
 * by itself — enforcement happens in the endpoint handlers (post-fetch
 * filtering for `read`, pre-write rejection for `write`, optional
 * `readPushdown` translated to `FilterCondition[]` for List).
 *
 * @example
 * ```ts
 * app.get('/posts', requirePolicy<Post>({
 *   read: (ctx, post) => post.authorId === ctx.userId || ctx.user?.roles?.includes('admin'),
 * }), PostList);
 * ```
 */
export function requirePolicy<T = unknown, E extends AuthEnv = AuthEnv>(
  policies: ModelPolicies<T>
): MiddlewareHandler<E> {
  return async (ctx, next) => {
    setContextVar(ctx, POLICIES_CONTEXT_KEY, policies);
    await next();
  };
}

// ============================================================================
// Approval Guard (Human-in-the-Loop deferred execution)
// ============================================================================

/**
 * Build a `requireApproval(...)` middleware for human-in-the-loop deferred
 * execution.
 *
 * On the first call (no resume marker in body):
 *   1. Parse the request body.
 *   2. Persist a `PendingAction` carrying the body, full actor identity
 *      from `c.var` (user, agent, etc.), and a deadline.
 *   3. Return `202 { status: 'pending', actionId, expiresAt }` to the
 *      caller. The handler does not run.
 *
 * On the resume call (`body[resumeMarker] = actionId`):
 *   1. Look up the action; reject if missing, expired, or not approved.
 *   2. Replay the original input as the request body (downstream
 *      `getValidatedData` reads it).
 *   3. Continue to the handler.
 *
 * The middleware does not authenticate — combine with `requireRoles` /
 * `requireAuth` upstream when the approval semantics need an authenticated
 * caller.
 *
 * @example
 * ```ts
 * app.post('/transfers',
 *   requireApproval({ reason: 'Funds transfer over $1k' }),
 *   TransferCreate,
 * );
 * ```
 */
export function requireApproval<E extends AuthEnv = AuthEnv>(
  config: ApprovalConfig
): MiddlewareHandler<E> {
  const storage: ApprovalStorage = config.approvalStorage;
  const resumeMarker = config.resumeMarker ?? '_resume_';
  const expireMs = parseIso8601Duration(config.expiresAfter ?? 'P1D');

  return async (ctx, next) => {
    let body: Record<string, unknown> = {};
    try {
      body = await ctx.req.json() as Record<string, unknown>;
    } catch {
      // Empty body — treat as initial-call with no input. Resume requires
      // a marker, so missing body means not a resume.
    }

    const resumeId = typeof body[resumeMarker] === 'string'
      ? body[resumeMarker] as string
      : undefined;

    // -------- Resume path ---------------------------------------------------
    if (resumeId) {
      const action = await storage.get(resumeId);
      if (!action) {
        throw new ForbiddenException(`Pending action ${resumeId} not found`);
      }
      if (action.status === 'expired') {
        throw new ForbiddenException(`Pending action ${resumeId} has expired`);
      }
      if (action.status !== 'approved') {
        throw new ForbiddenException(
          `Pending action ${resumeId} is ${action.status}, cannot resume`
        );
      }
      // Replay the original input. Hono's req.json() caches parsed body —
      // we monkey-patch via the bodyData cache so downstream readers see
      // the replayed input.
      replayRequestBody(ctx, action.input);
      await next();
      return;
    }

    // -------- Initial path: persist a pending action and return 202 -------
    const userId = getContextVar<string>(ctx, 'userId');
    const agentId = getContextVar<string>(ctx, 'agentId');
    const agentRunId = getContextVar<string>(ctx, 'agentRunId');
    const onBehalfOfUserId = getContextVar<string>(ctx, 'onBehalfOfUserId');
    const toolCallId = getContextVar<string>(ctx, 'toolCallId');
    const tenantId = getContextVar<string>(ctx, 'tenantId');
    const organizationId = getContextVar<string>(ctx, 'organizationId');
    const explicitSource = getContextVar<ActionSource>(ctx, 'actionSource');
    const source: ActionSource =
      explicitSource ?? (agentId ? 'agent-mcp' : 'http');

    const now = Date.now();
    const action: PendingAction = {
      id: crypto.randomUUID(),
      tenantId,
      organizationId,
      userId,
      actorUserId: userId,
      onBehalfOfUserId,
      agentId,
      agentRunId,
      toolCallId,
      source,
      toolName: config.toolName ?? `${ctx.req.method} ${ctx.req.path}`,
      input: body,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expireMs).toISOString(),
      reason: config.reason,
    };
    await storage.create(action);

    return ctx.json(
      {
        status: 'pending',
        actionId: action.id,
        expiresAt: action.expiresAt,
        reason: action.reason,
      },
      202
    );
  };
}

/**
 * Replay a previously-captured request body so the handler reads it as if
 * it were the original. Hono's `c.req.json()` is implemented as
 * `cachedBody('text').then(JSON.parse)`, so the canonical cache slot is
 * `bodyCache.text` (a Promise / string of the raw body text). We:
 *   1. Stringify the replayed input.
 *   2. Replace `bodyCache.text` so any subsequent `.json()` / `.text()`
 *      / `.parseBody()` reads the replayed body.
 *   3. Clear `bodyCache.parsedBody` (form-parser cache) for the same
 *      reason.
 */
function replayRequestBody(
  ctx: { req: { bodyCache?: Record<string, unknown> } },
  input: unknown
): void {
  const req = ctx.req;
  // Hono's `cachedBody` reads expect `bodyCache.text` to be a Promise<string>
  // (returned by raw.text()). Match that shape exactly.
  const textPromise = Promise.resolve(JSON.stringify(input));
  if (!req.bodyCache) {
    (req as { bodyCache: Record<string, unknown> }).bodyCache = { text: textPromise };
  } else {
    req.bodyCache.text = textPromise;
    delete req.bodyCache.parsedBody;
    delete req.bodyCache.json;
  }
}
