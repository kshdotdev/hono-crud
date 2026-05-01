/**
 * Generic Hono context-variable accessors.
 *
 * Auth-specific helpers (getUser, hasRole, hasPermission, …) live in
 * `src/auth/context.ts`. This module is for cross-cutting concerns:
 * `getRequestId`, `getTenantId`, generic `getContextVar`/`setContextVar`.
 */

import type { Context, Env } from 'hono';

export function getContextVar<T>(ctx: unknown, key: string): T | undefined {
  const obj = ctx as { var?: Record<string, unknown> };
  return obj?.var?.[key] as T | undefined;
}

export function setContextVar<E extends Env>(
  ctx: Context<E>,
  key: string,
  value: unknown
): void {
  (ctx as unknown as { set: (k: string, v: unknown) => void }).set(key, value);
}

export function getRequestId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'requestId');
}

export function getTenantId<E extends Env>(
  ctx: Context<E>,
  key = 'tenantId'
): string | undefined {
  return getContextVar<string>(ctx, key);
}

/**
 * Generate a unique request ID using Web Crypto.
 * Falls back to crypto.getRandomValues then to Math.random.
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
