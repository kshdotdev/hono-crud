import type { Context, Env } from 'hono';
import type { PathPattern, RedactField } from './types.js';
import { getContextVar } from '../core/context-helpers.js';

// ============================================================================
// Redaction Utilities
// ============================================================================

/**
 * Check if a field name should be redacted.
 *
 * @param fieldName - The field name to check
 * @param patterns - Array of patterns to match against
 * @returns True if the field should be redacted
 */
export function shouldRedact(fieldName: string, patterns: RedactField[]): boolean {
  const lowerFieldName = fieldName.toLowerCase();

  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      if (pattern.test(fieldName)) {
        return true;
      }
    } else {
      // String pattern - case-insensitive exact match or glob
      const lowerPattern = pattern.toLowerCase();

      if (lowerPattern.includes('*')) {
        // Convert glob to regex
        const regexPattern = lowerPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        if (new RegExp(`^${regexPattern}$`).test(lowerFieldName)) {
          return true;
        }
      } else {
        // Exact match
        if (lowerFieldName === lowerPattern) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Recursively redact sensitive fields in an object.
 *
 * @param obj - The object to redact
 * @param patterns - Array of field patterns to redact
 * @returns A new object with redacted fields
 */
export function redactObject(
  obj: unknown,
  patterns: RedactField[]
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, patterns));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (shouldRedact(key, patterns)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, patterns);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Redact sensitive header values.
 *
 * @param headers - Headers object to redact
 * @param patterns - Array of header patterns to redact
 * @returns A new object with redacted header values
 */
export function redactHeaders(
  headers: Record<string, string>,
  patterns: RedactField[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (shouldRedact(key, patterns)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
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
    // Escape special regex chars first, but use placeholders for wildcards
    let regexPattern = pattern
      .replace(/\*\*/g, '\0DOUBLE_STAR\0')
      .replace(/\*/g, '\0SINGLE_STAR\0')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\0DOUBLE_STAR\0/g, '.*')
      .replace(/\0SINGLE_STAR\0/g, '[^/]*');

    return new RegExp(`^${regexPattern}$`).test(path);
  }

  // Exact match
  return path === pattern;
}

/**
 * Determine if a path should be excluded from logging.
 *
 * @param path - The path to check
 * @param includePaths - Paths to include (empty = all)
 * @param excludePaths - Paths to exclude (takes precedence)
 * @returns True if the path should be excluded (not logged)
 */
export function shouldExcludePath(
  path: string,
  includePaths: PathPattern[],
  excludePaths: PathPattern[]
): boolean {
  // Check exclusions first (they take precedence)
  for (const pattern of excludePaths) {
    if (matchPath(path, pattern)) {
      return true;
    }
  }

  // If no include patterns specified, include all
  if (includePaths.length === 0) {
    return false;
  }

  // Check if path matches any include pattern
  for (const pattern of includePaths) {
    if (matchPath(path, pattern)) {
      return false;
    }
  }

  // Path doesn't match any include pattern
  return true;
}

// ============================================================================
// Request Utilities
// ============================================================================

/**
 * Extract client IP address from request.
 * Checks proxy headers first if trustProxy is enabled.
 *
 * @param ctx - Hono context
 * @param ipHeader - Header name for proxy IP (default: 'X-Forwarded-For')
 * @param trustProxy - Whether to trust proxy headers (default: true)
 * @returns The client IP address or undefined
 */
export function extractClientIp<E extends Env>(
  ctx: Context<E>,
  ipHeader: string = 'X-Forwarded-For',
  trustProxy: boolean = true
): string | undefined {
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

  return undefined;
}

/**
 * Extract headers from a Headers object to a plain object.
 *
 * @param headers - Headers object
 * @returns Plain object with header key-value pairs
 */
export function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });

  return result;
}

/**
 * Extract query parameters from context.
 *
 * @param ctx - Hono context
 * @returns Object with query parameters
 */
export function extractQuery<E extends Env>(ctx: Context<E>): Record<string, string> {
  const result: Record<string, string> = {};
  const url = new URL(ctx.req.url);

  url.searchParams.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

// ============================================================================
// Body Utilities
// ============================================================================

/**
 * Truncate a string or buffer to a maximum size.
 *
 * @param data - Data to truncate
 * @param maxSize - Maximum size in bytes
 * @returns Truncated data with indicator if truncated
 */
export function truncateBody(data: string | unknown, maxSize: number): unknown {
  if (typeof data === 'string') {
    if (data.length > maxSize) {
      return data.substring(0, maxSize) + '... [TRUNCATED]';
    }
    return data;
  }

  // For objects, stringify and check size
  const str = JSON.stringify(data);
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _maxSize: maxSize };
  }

  return data;
}

/**
 * Check if content type matches any of the allowed types.
 *
 * @param contentType - Content-Type header value
 * @param allowedTypes - Array of allowed content types
 * @returns True if content type is allowed
 */
export function isAllowedContentType(
  contentType: string | null | undefined,
  allowedTypes: string[]
): boolean {
  if (!contentType) {
    return false;
  }

  // Empty array means all types are allowed
  if (allowedTypes.length === 0) {
    return true;
  }

  const lowerContentType = contentType.toLowerCase();

  for (const allowed of allowedTypes) {
    if (lowerContentType.includes(allowed.toLowerCase())) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// User ID Extraction
// ============================================================================

/**
 * Extract authenticated user ID from context.
 * Requires auth middleware to be applied first.
 *
 * @param ctx - Hono context
 * @returns The user ID or undefined if not authenticated
 */
export function extractUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'userId') || undefined;
}

// ============================================================================
// UUID Generation
// ============================================================================

/**
 * Generate a unique request ID.
 * Uses crypto.randomUUID() if available, falls back to custom implementation.
 *
 * @returns A unique ID string
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
