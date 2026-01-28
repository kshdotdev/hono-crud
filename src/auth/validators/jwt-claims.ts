import type { JWTClaims } from '../types.js';
import { UnauthorizedException } from '../../core/exceptions.js';

/**
 * Options for JWT claims validation.
 */
export interface JWTClaimsValidationOptions {
  /**
   * Clock tolerance in seconds for exp/nbf validation.
   * Note: When using Hono's verify(), exp/nbf are validated automatically.
   * This option is kept for backwards compatibility and manual validation.
   * @default 0
   */
  clockTolerance?: number;

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
   * Skip exp/nbf validation (useful when Hono's verify() already validated them).
   * @default false
   */
  skipTimeValidation?: boolean;
}

/**
 * Validates JWT claims including issuer and audience.
 *
 * Note: When using with Hono's verify() function, exp/nbf/iat are already
 * validated. This function focuses on issuer and audience validation which
 * Hono doesn't automatically perform.
 *
 * @param claims - The decoded JWT claims to validate
 * @param options - Validation options
 * @throws UnauthorizedException if validation fails
 *
 * @example
 * ```ts
 * // After Hono's verify() has validated the token
 * validateJWTClaims(claims, {
 *   issuer: 'my-app',
 *   audience: 'my-audience',
 *   skipTimeValidation: true, // Hono already validated exp/nbf
 * });
 * ```
 */
export function validateJWTClaims(
  claims: JWTClaims,
  options: JWTClaimsValidationOptions = {}
): void {
  const { clockTolerance = 0, issuer, audience, skipTimeValidation = false } = options;

  // Only check time-based claims if not skipped (for backwards compatibility)
  if (!skipTimeValidation) {
    const now = Math.floor(Date.now() / 1000);

    // Check expiration
    if (claims.exp !== undefined) {
      if (now > claims.exp + clockTolerance) {
        throw new UnauthorizedException('Token has expired');
      }
    }

    // Check not before
    if (claims.nbf !== undefined) {
      if (now < claims.nbf - clockTolerance) {
        throw new UnauthorizedException('Token not yet valid');
      }
    }
  }

  // Check issuer
  if (issuer !== undefined) {
    if (claims.iss !== issuer) {
      throw new UnauthorizedException('Invalid token issuer');
    }
  }

  // Check audience
  if (audience !== undefined) {
    const expectedAud = Array.isArray(audience) ? audience : [audience];
    const tokenAud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

    const hasValidAud = expectedAud.some((aud) => tokenAud.includes(aud));
    if (!hasValidAud) {
      throw new UnauthorizedException('Invalid token audience');
    }
  }
}
