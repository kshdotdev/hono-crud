import type { Context, Env } from 'hono';
import {
  getClientIp,
  getUserId as getUserIdShared,
  matchPath as sharedMatchPath,
} from 'hono-crud/internal';
import type { PathPattern } from './types';

// ============================================================================
// IP Extraction
// ============================================================================

/**
 * Extract client IP address from request.
 * Returns `'unknown'` if no IP can be determined (the shared helper returns
 * undefined). This sentinel is intentional fail-closed behavior, NOT a
 * convention violation: a falsy key makes the middleware skip rate limiting
 * entirely, so an underivable IP must still produce a usable bucket key —
 * rate limiting must not fail open exactly when the client is unidentifiable.
 *
 * `trustProxy` defaults to `true` (library-wide default — on edge runtimes
 * the client IP only exists in proxy headers); pass `false` to suppress
 * proxy-header lookup.
 */
export function extractIP<E extends Env>(
  ctx: Context<E>,
  ipHeader = 'X-Forwarded-For',
  trustProxy = true,
): string {
  return getClientIp(ctx, { ipHeader, trustProxy }) ?? 'unknown';
}

// ============================================================================
// User ID Extraction
// ============================================================================

export function extractUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getUserIdShared(ctx);
}

// ============================================================================
// API Key Extraction
// ============================================================================

export function extractAPIKey<E extends Env>(
  ctx: Context<E>,
  headerName = 'X-API-Key',
): string | undefined {
  return ctx.req.header(headerName) || undefined;
}

// ============================================================================
// Path Matching
// ============================================================================

export function matchPath(path: string, pattern: PathPattern): boolean {
  return sharedMatchPath(path, pattern);
}

export function shouldSkipPath(path: string, patterns: PathPattern[]): boolean {
  return patterns.some((pattern) => sharedMatchPath(path, pattern));
}

// ============================================================================
// Key Generation
// ============================================================================

export function generateKey(prefix: string, ...parts: (string | undefined)[]): string {
  const filteredParts = parts.filter((p): p is string => p !== undefined && p !== '');
  return `${prefix}:${filteredParts.join(':')}`;
}
