import type { Hono } from 'hono';
import { CRUD_ROUTES } from 'hono-crud/internal';
import type { RequestPlan } from './schema';
import type { OperationName } from './types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RouteSpec {
  method: HttpMethod;
  /** Sub-path template relative to the resource root, e.g. `/:id/versions/:version`. */
  subPath: string;
}

/**
 * Per-operation HTTP method + sub-path template, derived from core's canonical
 * `CRUD_ROUTES` table so MCP dispatch can never drift from what `registerCrud`
 * mounts. `import` is excluded from the MCP surface (see {@link OperationName}).
 */
const ROUTES = Object.fromEntries(
  CRUD_ROUTES.filter(([name]) => name !== 'import').map(([name, method, subPath]) => [
    name,
    { method: method.toUpperCase() as HttpMethod, subPath },
  ]),
) as Record<OperationName, RouteSpec>;

type Args = Record<string, unknown>;

/** Inbound request headers, as exposed by the MCP SDK's `extra.requestInfo.headers`. */
export type ForwardHeaders = Record<string, string | string[] | undefined>;

/**
 * Headers forwarded on re-dispatch when `CrudMcpConfig.forwardHeaders` is
 * unset: bearer/session auth plus core's own API-key (`createAPIKeyMiddleware`)
 * and multi-tenant (`multiTenant`) default headers.
 */
export const DEFAULT_FORWARD_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-tenant-id',
];

export interface DispatchTarget {
  operation: OperationName;
  /** Resource mount path without trailing slash, e.g. `/users`. */
  basePath: string;
  plan: RequestPlan;
}

function encodeQuery(params: Args): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, String(v));
    } else if (typeof value === 'object') {
      usp.append(key, JSON.stringify(value));
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function pick(obj: Args, keys: string[]): Args {
  const out: Args = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}

function omit(obj: Args, keys: string[]): Args {
  const out: Args = { ...obj };
  for (const key of keys) delete out[key];
  return out;
}

/**
 * Forward allow-listed identity-bearing headers (matched case-insensitively)
 * so the re-dispatched request runs as the caller.
 */
function applyForwardHeaders(
  headers: ForwardHeaders | undefined,
  allowed: readonly string[],
  target: Headers,
): void {
  if (!headers) return;
  const allow = new Set(allowed.map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(headers)) {
    if (!allow.has(name.toLowerCase())) continue;
    if (typeof value === 'string') target.set(name, value);
    else if (Array.isArray(value) && value.length > 0) target.set(name, value.join(', '));
  }
}

/**
 * Substitute every `:param` segment of a sub-path template from the tool args
 * (e.g. `/:id/versions/:version` + `{ id, version }`). Returns the resolved
 * path and the arg names consumed by the substitution.
 */
function buildPath(subPath: string, args: Args): { path: string; consumed: string[] } {
  const consumed: string[] = [];
  const path = subPath.replace(/:([^/]+)/g, (_match, name: string) => {
    consumed.push(name);
    return encodeURIComponent(String(args[name] ?? ''));
  });
  return { path, consumed };
}

/**
 * Translate a tool call into an internal HTTP request and re-dispatch it through
 * the mounted Hono app, so the full CRUD pipeline (auth, validation, hooks,
 * serialization, pagination) runs exactly as it does for REST.
 *
 * The split of the flat tool input is schema-driven: path params are
 * substituted into the route template; when the endpoint declares a JSON body,
 * the declared query keys go to the query string and the rest becomes the
 * body (covers `bulkPatch`'s query+body mix and `batchDelete`'s DELETE-with-body);
 * body-less endpoints send every remaining arg as query.
 */
export async function dispatch(
  // biome-ignore lint/suspicious/noExplicitAny: re-dispatch targets any Hono app.
  app: Hono<any, any, any>,
  target: DispatchTarget,
  args: Args,
  headers?: ForwardHeaders,
  allowHeaders: readonly string[] = DEFAULT_FORWARD_HEADERS,
): Promise<Response> {
  const { operation, basePath, plan } = target;
  const { method, subPath } = ROUTES[operation];

  const requestHeaders = new Headers();
  applyForwardHeaders(headers, allowHeaders, requestHeaders);

  const { path, consumed } = buildPath(subPath, args);
  const remaining = omit(args, [...consumed, ...plan.paramKeys]);

  let body: string | undefined;
  let query: Args;
  if (plan.hasBody) {
    query = pick(remaining, plan.queryKeys);
    body = JSON.stringify(omit(remaining, plan.queryKeys));
  } else {
    query = remaining;
  }

  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  return app.request(basePath + path + encodeQuery(query), {
    method,
    headers: requestHeaders,
    body,
  });
}

export interface ToolCallResult {
  content: { type: 'text'; text: string }[];
  /** Parsed JSON body of a 2xx response, per the MCP structured-output contract. */
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

/**
 * Format an HTTP Response into an MCP tool result: pretty JSON when possible,
 * plus `structuredContent` for 2xx JSON object responses.
 */
export async function toToolResult(res: Response): Promise<ToolCallResult> {
  const text = await res.text();
  let formatted = text;
  let structured: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    formatted = JSON.stringify(parsed, null, 2);
    if (res.status < 400 && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON body — return verbatim.
  }
  return {
    content: [{ type: 'text', text: formatted }],
    ...(structured !== undefined && { structuredContent: structured }),
    isError: res.status >= 400,
  };
}
