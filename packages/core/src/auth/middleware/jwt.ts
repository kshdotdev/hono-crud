import type { Context, MiddlewareHandler } from 'hono';
import { decode, verify } from 'hono/jwt';
import type { JWTPayload } from 'hono/utils/jwt/types';
import { UnauthorizedException } from '../../core/exceptions';
import { setAuthContext } from '../context';
import type { AuthEnv, AuthUser, JWTAlgorithm, JWTClaims, JWTConfig } from '../types';
import { JWT_ALGORITHMS, safeParseJWTClaims } from '../types';
import { validateJWTClaims } from '../validators/jwt-claims';

// ============================================================================
// Algorithm Mapping
// ============================================================================

/**
 * Validate that the configured algorithm is one this middleware supports.
 *
 * `JWTAlgorithm` already enumerates exactly the algorithms Hono's `verify`
 * accepts, so the previous separate `HonoAlgorithm` type and hand-maintained
 * `supported` allow-list were redundant copies of the same set (and forced two
 * casts). The runtime check still guards against an invalid value arriving
 * through a non-type-checked path (e.g. a config object cast from `unknown`).
 */
function validateAlgorithm(algorithm: JWTAlgorithm): JWTAlgorithm {
  if (!JWT_ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  return algorithm;
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Default function to extract a Bearer token from the `Authorization` header.
 * Exported via `hono-crud/internal` so first-party addons (e.g. `@hono-crud/mcp`)
 * can reuse the same extraction logic instead of reimplementing it.
 */
export function defaultExtractToken(ctx: Context): string | null {
  const authHeader = ctx.req.header('Authorization');
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Default function to extract user info from JWT claims.
 */
/** Normalize a `string | string[]` claim to a string array (or undefined). */
function normalizeStringList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function defaultExtractUser(claims: JWTClaims): AuthUser {
  return {
    id: String(claims.sub || claims.id || ''),
    email: claims.email,
    // `roles` (array or single) falls back to the singular `role` claim; both
    // are normalized to a string[] so a single-role token no longer yields a
    // bare string mistyped as string[].
    roles: normalizeStringList(claims.roles ?? claims.role),
    permissions: normalizeStringList(claims.permissions),
    metadata: claims.metadata,
  };
}

// ============================================================================
// Shared verification helpers
// ============================================================================

/**
 * Decode a token's header and assert its algorithm matches the expected one.
 *
 * Shared by {@link createJWTMiddleware} and {@link verifyJWT}: both must reject
 * a token whose header is missing or whose `alg` differs from the configured
 * algorithm before handing it to Hono's `verify`.
 */
function decodeAndAssertAlg(token: string, algorithm: JWTAlgorithm): void {
  const decoded = decode(token);
  if (!decoded || !decoded.header) {
    throw new UnauthorizedException('Invalid token format');
  }

  if (decoded.header.alg !== algorithm) {
    throw new UnauthorizedException('Invalid token algorithm');
  }
}

/**
 * Map an error thrown by Hono's `verify` to the appropriate
 * {@link UnauthorizedException}. Shared by {@link createJWTMiddleware} and
 * {@link verifyJWT}; the fallthrough is a generic 'Invalid token'.
 */
function classifyVerifyError(error: unknown): UnauthorizedException {
  if (error instanceof Error) {
    if (error.message.includes('expired') || error.name === 'JwtTokenExpired') {
      return new UnauthorizedException('Token has expired');
    }
    if (error.message.includes('signature') || error.name === 'JwtTokenSignatureMismatched') {
      return new UnauthorizedException('Invalid token signature');
    }
    if (error.message.includes('not valid yet') || error.name === 'JwtTokenNotYetValid') {
      return new UnauthorizedException('Token not yet valid');
    }
  }
  return new UnauthorizedException('Invalid token');
}

// ============================================================================
// JWT Middleware
// ============================================================================

/**
 * Creates JWT authentication middleware using Hono's built-in JWT helpers.
 *
 * @example
 * ```ts
 * const app = new Hono<AuthEnv>();
 *
 * app.use('*', createJWTMiddleware({
 *   secret: c.env.JWT_SECRET,
 *   issuer: 'my-app',
 * }));
 *
 * app.get('/me', (c) => {
 *   return c.json({ userId: c.var.userId });
 * });
 * ```
 */
export function createJWTMiddleware<E extends AuthEnv = AuthEnv>(
  config: JWTConfig,
): MiddlewareHandler<E> {
  const algorithm = validateAlgorithm(config.algorithm || 'HS256');
  const clockToleranceSeconds = config.clockToleranceSeconds || 0;
  const extractToken = config.extractToken || defaultExtractToken;
  const extractUser = config.extractUser || defaultExtractUser;

  return async (ctx, next) => {
    // Extract token
    const token = extractToken(ctx as unknown as Context);
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    // Decode header to verify algorithm before verification
    decodeAndAssertAlg(token, algorithm);

    // Verify signature using Hono's verify function
    let payload: JWTPayload;
    try {
      payload = await verify(token, config.secret, algorithm);
    } catch (error) {
      throw classifyVerifyError(error);
    }

    // Validate the verified payload against the claims schema. Hono's `verify`
    // checks the signature and exp/nbf timing, but not the *shape* of the
    // claims — so a structurally malformed payload would otherwise be trusted
    // via a blind cast. Reject it instead.
    const parsed = safeParseJWTClaims(payload);
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid token claims');
    }
    const claims = parsed.data;

    // Validate additional claims (issuer, audience) using shared validator
    // Note: Hono's verify already validates exp, nbf, iat
    validateJWTClaims(claims, {
      clockToleranceSeconds,
      issuer: config.issuer,
      audience: config.audience,
    });

    // Extract user info
    const user = extractUser(claims);

    // Publish the authenticated user to context
    setAuthContext(ctx, user, 'jwt');

    await next();
  };
}

/**
 * Verifies a JWT token and returns the claims.
 * Useful for manual token verification outside of middleware.
 *
 * @param token - The JWT token to verify
 * @param config - JWT configuration
 * @returns The decoded claims if valid
 * @throws UnauthorizedException if the token is invalid
 */
export async function verifyJWT(token: string, config: JWTConfig): Promise<JWTClaims> {
  const algorithm = validateAlgorithm(config.algorithm || 'HS256');
  const clockToleranceSeconds = config.clockToleranceSeconds || 0;

  // Decode header to verify algorithm
  decodeAndAssertAlg(token, algorithm);

  // Verify signature using Hono's verify function
  let payload: JWTPayload;
  try {
    payload = await verify(token, config.secret, algorithm);
  } catch (error) {
    throw classifyVerifyError(error);
  }

  // Validate the verified payload against the claims schema — the same
  // rejection createJWTMiddleware applies. Hono's `verify` checks the
  // signature and exp/nbf timing but not the *shape* of the claims, so a
  // structurally malformed payload must not be blessed into JWTClaims.
  const parsed = safeParseJWTClaims(payload);
  if (!parsed.success) {
    throw new UnauthorizedException('Invalid token claims');
  }
  const claims = parsed.data;

  // Validate additional claims using shared validator
  validateJWTClaims(claims, {
    clockToleranceSeconds,
    issuer: config.issuer,
    audience: config.audience,
  });

  return claims;
}

/**
 * Decodes a JWT token without verification.
 * WARNING: This does not verify the signature or validate claim shape. The
 * payload is honestly typed as hono's raw `JWTPayload` — narrow it with
 * `safeParseJWTClaims` (or run full `verifyJWT`) before trusting any claim.
 * Use only for debugging or when the token has already been verified.
 */
export function decodeJWT(token: string): { header: unknown; payload: JWTPayload } | null {
  try {
    const decoded = decode(token);
    if (!decoded || !decoded.header || !decoded.payload) {
      return null;
    }
    return {
      header: decoded.header,
      payload: decoded.payload,
    };
  } catch {
    return null;
  }
}
