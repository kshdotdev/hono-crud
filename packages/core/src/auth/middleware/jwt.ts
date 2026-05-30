import type { Context, MiddlewareHandler } from 'hono';
import { decode, verify } from 'hono/jwt';
import type { JWTPayload } from 'hono/utils/jwt/types';
import { CONTEXT_KEYS } from '../../core/context-keys';
import { UnauthorizedException } from '../../core/exceptions';
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
  const clockTolerance = config.clockTolerance || 0;
  const extractToken = config.extractToken || defaultExtractToken;
  const extractUser = config.extractUser || defaultExtractUser;

  return async (ctx, next) => {
    // Extract token
    const token = extractToken(ctx as unknown as Context);
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    // Decode header to verify algorithm before verification
    const decoded = decode(token);
    if (!decoded || !decoded.header) {
      throw new UnauthorizedException('Invalid token format');
    }

    // Verify header algorithm matches expected
    if (decoded.header.alg !== algorithm) {
      throw new UnauthorizedException('Invalid token algorithm');
    }

    // Verify signature using Hono's verify function
    let payload: JWTPayload;
    try {
      payload = await verify(token, config.secret, algorithm);
    } catch (error) {
      // Handle specific JWT errors
      if (error instanceof Error) {
        if (error.message.includes('expired') || error.name === 'JwtTokenExpired') {
          throw new UnauthorizedException('Token has expired');
        }
        if (error.message.includes('signature') || error.name === 'JwtTokenSignatureMismatched') {
          throw new UnauthorizedException('Invalid token signature');
        }
        if (error.message.includes('not valid yet') || error.name === 'JwtTokenNotYetValid') {
          throw new UnauthorizedException('Token not yet valid');
        }
      }
      throw new UnauthorizedException('Invalid token');
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
      clockTolerance,
      issuer: config.issuer,
      audience: config.audience,
    });

    // Extract user info
    const user = extractUser(claims);

    // Set context variables
    ctx.set(CONTEXT_KEYS.userId, user.id);
    ctx.set(CONTEXT_KEYS.user, user);
    ctx.set(CONTEXT_KEYS.roles, user.roles || []);
    ctx.set(CONTEXT_KEYS.permissions, user.permissions || []);
    ctx.set(CONTEXT_KEYS.authType, 'jwt');

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
  const clockTolerance = config.clockTolerance || 0;

  // Decode header to verify algorithm
  const decoded = decode(token);
  if (!decoded || !decoded.header) {
    throw new UnauthorizedException('Invalid token format');
  }

  // Verify header algorithm matches expected
  if (decoded.header.alg !== algorithm) {
    throw new UnauthorizedException('Invalid token algorithm');
  }

  // Verify signature using Hono's verify function
  let payload: JWTPayload;
  try {
    payload = await verify(token, config.secret as string, algorithm);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('expired') || error.name === 'JwtTokenExpired') {
        throw new UnauthorizedException('Token has expired');
      }
      if (error.message.includes('signature') || error.name === 'JwtTokenSignatureMismatched') {
        throw new UnauthorizedException('Invalid token signature');
      }
      if (error.message.includes('not valid yet') || error.name === 'JwtTokenNotYetValid') {
        throw new UnauthorizedException('Token not yet valid');
      }
    }
    throw new UnauthorizedException('Invalid token');
  }

  // Convert payload to JWTClaims
  const claims: JWTClaims = payload as unknown as JWTClaims;

  // Validate additional claims using shared validator
  validateJWTClaims(claims, {
    clockTolerance,
    issuer: config.issuer,
    audience: config.audience,
  });

  return claims;
}

/**
 * Decodes a JWT token without verification.
 * WARNING: This does not verify the signature. Use only for debugging or
 * when you know the token has already been verified.
 */
export function decodeJWT(token: string): { header: unknown; payload: JWTClaims } | null {
  try {
    const decoded = decode(token);
    if (!decoded || !decoded.header || !decoded.payload) {
      return null;
    }
    return {
      header: decoded.header,
      payload: decoded.payload as unknown as JWTClaims,
    };
  } catch {
    return null;
  }
}
