/**
 * Request introspection helpers — single source of truth for client-IP
 * and user-id extraction across rate-limit/, logging/, and audit/.
 *
 * Returns `string | undefined` consistently (no `'unknown'` sentinel).
 */

import type { Context, Env } from 'hono';
import { getContextVar } from './context';

export interface ClientIpOptions {
  /** Header to consult before others. Default: `X-Forwarded-For`. */
  ipHeader?: string;
  /**
   * If true, proxy headers are consulted first. Defaults to `true` because
   * edge runtimes (Cloudflare/Vercel/Fastly) virtually always sit behind a
   * trusted proxy. Set false to suppress that.
   */
  trustProxy?: boolean;
}

interface CloudflareRequest {
  cf?: { ip?: string };
}

interface NodeSocket {
  remoteAddress?: string;
}

export function getClientIp<E extends Env>(
  ctx: Context<E>,
  options: ClientIpOptions = {}
): string | undefined {
  const { ipHeader = 'X-Forwarded-For', trustProxy = true } = options;

  if (trustProxy) {
    const xff = ctx.req.header(ipHeader);
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const xri = ctx.req.header('X-Real-IP')?.trim();
    if (xri) return xri;
    const cfip = ctx.req.header('CF-Connecting-IP')?.trim();
    if (cfip) return cfip;
  }

  const raw = ctx.req.raw as Request & { socket?: NodeSocket; cf?: CloudflareRequest['cf'] };
  if (raw && typeof raw.socket === 'object' && raw.socket?.remoteAddress) {
    return raw.socket.remoteAddress;
  }
  if (raw?.cf?.ip) return raw.cf.ip;

  return undefined;
}

/** Reads `userId` from context (set by auth middleware). */
export function getUserId<E extends Env>(ctx: Context<E>): string | undefined {
  return getContextVar<string>(ctx, 'userId');
}
