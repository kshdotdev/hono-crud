import type { Context, Env } from 'hono';
import type { PathPattern, RedactField } from './types';
import { getClientIp, getUserId as getUserIdShared } from '../utils/request-info';
import { matchPath as sharedMatchPath } from '../utils/path-match';
import {
  redactObject as sharedRedactObject,
  redactHeaders as sharedRedactHeaders,
  shouldRedact as sharedShouldRedact,
} from '../utils/redact';
import { generateRequestId as sharedGenerateRequestId } from '../utils/context';

// ============================================================================
// Redaction Utilities
// ============================================================================

export function shouldRedact(fieldName: string, patterns: RedactField[]): boolean {
  return sharedShouldRedact(fieldName, patterns);
}

export function redactObject(obj: unknown, patterns: RedactField[]): unknown {
  return sharedRedactObject(obj, patterns);
}

export function redactHeaders(
  headers: Record<string, string>,
  patterns: RedactField[]
): Record<string, string> {
  return sharedRedactHeaders(headers, patterns);
}

// ============================================================================
// Path Matching
// ============================================================================

export function matchPath(path: string, pattern: PathPattern): boolean {
  return sharedMatchPath(path, pattern);
}

export function shouldExcludePath(
  path: string,
  includePaths: PathPattern[],
  excludePaths: PathPattern[]
): boolean {
  for (const pattern of excludePaths) {
    if (sharedMatchPath(path, pattern)) return true;
  }
  if (includePaths.length === 0) return false;
  for (const pattern of includePaths) {
    if (sharedMatchPath(path, pattern)) return false;
  }
  return true;
}

// ============================================================================
// Request Utilities
// ============================================================================

export function extractClientIp<E extends Env>(
  ctx: Context<E>,
  ipHeader: string = 'X-Forwarded-For',
  trustProxy: boolean = false
): string | undefined {
  // The logging extractor historically tried proxy headers regardless of
  // `trustProxy`, so preserve that behaviour by forcing `trustProxy` true here.
  return getClientIp(ctx, { ipHeader, trustProxy: trustProxy || true });
}

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
  allowedTypes: string[]
): boolean {
  if (!contentType) return false;
  if (allowedTypes.length === 0) return true;
  const lower = contentType.toLowerCase();
  for (const allowed of allowedTypes) {
    if (lower.includes(allowed.toLowerCase())) return true;
  }
  return false;
}

// ============================================================================
// User ID Extraction
// ============================================================================

export function extractUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getUserIdShared(ctx);
}

// ============================================================================
// UUID Generation
// ============================================================================

export function generateRequestId(): string {
  return sharedGenerateRequestId();
}
