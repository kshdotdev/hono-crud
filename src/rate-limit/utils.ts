import type { Context, Env } from 'hono';
import type { PathPattern } from './types.js';
import { getContextVar } from '../core/context-helpers.js';

// ============================================================================
// IP Extraction
// ============================================================================

/**
 * Extract client IP address from request.
 * Checks proxy headers first if trustProxy is enabled.
 *
 * @param ctx - Hono context
 * @param ipHeader - Header name for proxy IP (default: 'X-Forwarded-For')
 * @param trustProxy - Whether to trust proxy headers (default: true)
 * @returns The client IP address or 'unknown'
 */
export function extractIP<E extends Env>(
  ctx: Context<E>,
  ipHeader: string = 'X-Forwarded-For',
  trustProxy: boolean = true
): string {
  // Check proxy header first if trusted
  if (trustProxy) {
    const proxyHeader = ctx.req.header(ipHeader);
    if (proxyHeader) {
      // X-Forwarded-For can contain multiple IPs, take the first one
      const firstIP = proxyHeader.split(',')[0].trim();
      if (firstIP) {
        return firstIP;
      }
    }

    // Try other common proxy headers
    const realIP = ctx.req.header('X-Real-IP');
    if (realIP) {
      return realIP.trim();
    }

    const cfIP = ctx.req.header('CF-Connecting-IP');
    if (cfIP) {
      return cfIP.trim();
    }
  }

  // Fall back to connection info
  // Hono provides this via the raw request in some environments
  const raw = ctx.req.raw;
  if (raw && 'socket' in raw && raw.socket && typeof raw.socket === 'object') {
    const socket = raw.socket as { remoteAddress?: string };
    if (socket.remoteAddress) {
      return socket.remoteAddress;
    }
  }

  // In Cloudflare Workers, IP is in cf.ip
  // @ts-expect-error - cf is not typed in all environments
  if (raw && raw.cf && raw.cf.ip) {
    // @ts-expect-error - cf is not typed in all environments
    return raw.cf.ip;
  }

  return 'unknown';
}

// ============================================================================
// User ID Extraction
// ============================================================================

/**
 * Extract authenticated user ID from context.
 * Requires auth middleware to be applied first.
 *
 * @param ctx - Hono context
 * @returns The user ID or null if not authenticated
 */
export function extractUserId<E extends Env>(ctx: Context<E>): string | null {
  return getContextVar<string>(ctx, 'userId') || null;
}

// ============================================================================
// API Key Extraction
// ============================================================================

/**
 * Extract API key from request header.
 *
 * @param ctx - Hono context
 * @param headerName - Header name (default: 'X-API-Key')
 * @returns The API key or null if not present
 */
export function extractAPIKey<E extends Env>(
  ctx: Context<E>,
  headerName: string = 'X-API-Key'
): string | null {
  const apiKey = ctx.req.header(headerName);
  return apiKey || null;
}

// ============================================================================
// Path Matching
// ============================================================================

/**
 * Check if a path matches a pattern.
 * Supports exact paths, wildcards, and regex.
 *
 * @param path - The path to check
 * @param pattern - The pattern to match against
 * @returns True if the path matches
 */
export function matchPath(path: string, pattern: PathPattern): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(path);
  }

  // Handle wildcards
  if (pattern.includes('*')) {
    // ** matches any number of path segments
    if (pattern.includes('**')) {
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      return new RegExp(`^${regexPattern}$`).test(path);
    }

    // * matches a single path segment
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regexPattern}$`).test(path);
  }

  // Exact match
  return path === pattern;
}

/**
 * Check if a path should skip rate limiting.
 *
 * @param path - The path to check
 * @param patterns - Array of patterns to skip
 * @returns True if the path should be skipped
 */
export function shouldSkipPath(path: string, patterns: PathPattern[]): boolean {
  return patterns.some((pattern) => matchPath(path, pattern));
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a rate limit key from components.
 *
 * @param prefix - Key prefix (e.g., 'rl')
 * @param parts - Key parts to join
 * @returns The generated key
 */
export function generateKey(prefix: string, ...parts: (string | undefined)[]): string {
  const filteredParts = parts.filter((p): p is string => p !== undefined && p !== '');
  return `${prefix}:${filteredParts.join(':')}`;
}
