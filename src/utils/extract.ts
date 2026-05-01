/**
 * Header / query / body extraction helpers shared across middlewares.
 * All return `string | undefined` for consistency.
 */

import type { Context, Env } from 'hono';

export function extractFromHeader<E extends Env>(
  ctx: Context<E>,
  name: string
): string | undefined {
  return ctx.req.header(name)?.trim() || undefined;
}

export function extractFromQuery<E extends Env>(
  ctx: Context<E>,
  name: string
): string | undefined {
  const v = ctx.req.query(name);
  return v ? v.trim() || undefined : undefined;
}

export function extractBearerToken<E extends Env>(
  ctx: Context<E>,
  headerName = 'Authorization'
): string | undefined {
  const header = ctx.req.header(headerName);
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
