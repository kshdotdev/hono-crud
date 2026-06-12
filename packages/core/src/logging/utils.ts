/**
 * Logging-owned helpers. Shared concerns (path matching, redaction,
 * client-IP / user-id extraction, request-id generation) live in the
 * canonical `utils/` modules and are re-exported through `./index`.
 */

import type { Context, Env } from 'hono';
import { isPathIncluded } from '../utils/path-match';
import type { PathPattern } from './types';

// ============================================================================
// Path Matching
// ============================================================================

/**
 * True when a path should NOT be logged. Thin negation of the canonical
 * include/exclude evaluation (`isPathIncluded`): excludes always win; an
 * empty include list means "log everything not excluded".
 */
export function shouldExcludePath(
  path: string,
  includePaths: PathPattern[],
  excludePaths: PathPattern[],
): boolean {
  return !isPathIncluded(path, includePaths, excludePaths);
}

// ============================================================================
// Request Utilities
// ============================================================================

export function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

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

export function truncateBody(data: string | unknown, maxSize: number): unknown {
  if (typeof data === 'string') {
    if (data.length > maxSize) {
      return data.substring(0, maxSize) + '... [TRUNCATED]';
    }
    return data;
  }
  const str = JSON.stringify(data);
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _maxSize: maxSize };
  }
  return data;
}

export function isAllowedContentType(
  contentType: string | null | undefined,
  allowedTypes: string[],
): boolean {
  if (!contentType) return false;
  if (allowedTypes.length === 0) return true;
  const lower = contentType.toLowerCase();
  for (const allowed of allowedTypes) {
    if (lower.includes(allowed.toLowerCase())) return true;
  }
  return false;
}
