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
 * Returns `'unknown'` if no IP can be determined (rate-limit module historically
 * uses a sentinel string for the bucket key; the shared helper returns undefined).
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

export function extractUserId<E extends Env>(ctx: Context<E>): string | null {
  return getUserIdShared(ctx) ?? null;
}

// ============================================================================
// API Key Extraction
// ============================================================================

export function extractAPIKey<E extends Env>(
  ctx: Context<E>,
  headerName = 'X-API-Key',
): string | null {
  return ctx.req.header(headerName) || null;
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
