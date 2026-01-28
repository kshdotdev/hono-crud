import type { Context, MiddlewareHandler } from 'hono';
import { verify, decode } from 'hono/jwt';
import type { JWTPayload } from 'hono/utils/jwt/types';
import type { AuthEnv, JWTConfig, JWTClaims, JWTAlgorithm, AuthUser } from '../types.js';
import { UnauthorizedException } from '../../core/exceptions.js';
import { validateJWTClaims } from '../validators/jwt-claims.js';

// ============================================================================
// Algorithm Mapping
// ============================================================================

/**
 * Map custom JWTAlgorithm to Hono's supported algorithm types.
 * Hono's JWT supports: HS256, HS384, HS512, RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512
 */
type HonoAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';

/**
 * Validates that the algorithm is supported by Hono's JWT.
 */
function validateAlgorithm(algorithm: JWTAlgorithm): HonoAlgorithm {
  const supported: HonoAlgorithm[] = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
  if (!supported.includes(algorithm as HonoAlgorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  return algorithm as HonoAlgorithm;
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Default function to extract the token from the request.
 */
function defaultExtractToken(ctx: Context): string | null {
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
function defaultExtractUser(claims: JWTClaims): AuthUser {
  return {
    id: String(claims.sub || claims.id || ''),
    email: claims.email as string | undefined,
    roles: (claims.roles || claims.role) as string[] | undefined,
    permissions: claims.permissions as string[] | undefined,
    metadata: claims.metadata as Record<string, unknown> | undefined,
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
 *   secret: process.env.JWT_SECRET!,
 *   issuer: 'my-app',
 * }));
 *
 * app.get('/me', (c) => {
 *   return c.json({ userId: c.var.userId });
 * });
 * ```
 */
export function createJWTMiddleware<E extends AuthEnv = AuthEnv>(
  config: JWTConfig
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
      payload = await verify(token, config.secret as string, algorithm);
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

    // Convert payload to JWTClaims
    const claims: JWTClaims = payload as unknown as JWTClaims;

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
    ctx.set('userId', user.id);
    ctx.set('user', user);
    ctx.set('roles', user.roles || []);
    ctx.set('permissions', user.permissions || []);
    ctx.set('authType', 'jwt');

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
export async function verifyJWT(
  token: string,
  config: JWTConfig
): Promise<JWTClaims> {
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
