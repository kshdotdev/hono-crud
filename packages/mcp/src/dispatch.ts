import type { Hono } from 'hono';
import type { RequestPlan } from './schema';
import type { OperationName } from './types';

const METHOD: Record<OperationName, 'GET' | 'POST' | 'PATCH' | 'DELETE'> = {
  list: 'GET',
  read: 'GET',
  create: 'POST',
  update: 'PATCH',
  delete: 'DELETE',
};

type Args = Record<string, unknown>;

/** Inbound request headers, as exposed by the MCP SDK's `extra.requestInfo.headers`. */
export type ForwardHeaders = Record<string, string | string[] | undefined>;

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

/** Forward identity-bearing headers so the re-dispatched request runs as the caller. */
function forwardHeaders(headers: ForwardHeaders | undefined, target: Headers): void {
  if (!headers) return;
  for (const name of ['authorization', 'cookie']) {
    const value = headers[name];
    if (typeof value === 'string') target.set(name, value);
    else if (Array.isArray(value) && value.length > 0) target.set(name, value.join(', '));
  }
}

/**
 * Translate a tool call into an internal HTTP request and re-dispatch it through
 * the mounted Hono app, so the full CRUD pipeline (auth, validation, hooks,
 * serialization, pagination) runs exactly as it does for REST.
 */
export async function dispatch(
  // biome-ignore lint/suspicious/noExplicitAny: re-dispatch targets any Hono app.
  app: Hono<any, any, any>,
  target: DispatchTarget,
  args: Args,
  headers?: ForwardHeaders,
): Promise<Response> {
  const { operation, basePath, plan } = target;
  const requestHeaders = new Headers();
  forwardHeaders(headers, requestHeaders);

  const idKey = plan.paramKeys[0];
  const id = idKey ? encodeURIComponent(String(args[idKey])) : '';

  let url = basePath;
  let body: string | undefined;

  switch (operation) {
    case 'list':
      url = basePath + encodeQuery(args);
      break;
    case 'read':
      url = `${basePath}/${id}${encodeQuery(pick(args, plan.queryKeys))}`;
      break;
    case 'create':
      url = basePath;
      body = JSON.stringify(args);
      requestHeaders.set('content-type', 'application/json');
      break;
    case 'update':
      url = `${basePath}/${id}`;
      body = JSON.stringify(omit(args, plan.paramKeys));
      requestHeaders.set('content-type', 'application/json');
      break;
    case 'delete':
      url = `${basePath}/${id}`;
      break;
  }

  return app.request(url, { method: METHOD[operation], headers: requestHeaders, body });
}

export interface ToolCallResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

/** Format an HTTP Response into an MCP tool result (pretty JSON when possible). */
export async function toToolResult(res: Response): Promise<ToolCallResult> {
  const text = await res.text();
  let formatted = text;
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Non-JSON body — return verbatim.
  }
  return {
    content: [{ type: 'text', text: formatted }],
    isError: res.status >= 400,
  };
}
