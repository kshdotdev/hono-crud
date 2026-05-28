import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Identity, McpAuthOptions } from './types';

export interface ResolvedAuth {
  /** Mount auxiliary routers (e.g. OAuth metadata). Called once at setup. */
  // biome-ignore lint/suspicious/noExplicitAny: mounts onto any Hono app.
  mount(app: Hono<any, any, any>): void;
  /** Gate a request. Return a Response to short-circuit (e.g. 401), or undefined to proceed. */
  gate(c: Context): Promise<Response | undefined>;
}

function unauthorized(c: Context, message: string): Response {
  return c.json({ success: false, error: { code: 'UNAUTHORIZED', message } }, 401);
}

function bearerToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match ? match[1] : undefined;
}

/**
 * Run gate-style middleware: each must call `next()` on success or respond on
 * failure. If a middleware does not call `next()`, its response short-circuits.
 */
async function runGate(c: Context, middleware: MiddlewareHandler[]): Promise<Response | undefined> {
  for (const mw of middleware) {
    let proceeded = false;
    const result = await mw(c, async () => {
      proceeded = true;
    });
    if (!proceeded) return (result as Response | undefined) ?? c.res;
  }
  return undefined;
}

const NO_AUTH: ResolvedAuth = { mount() {}, gate: async () => undefined };

/** One resolver per auth strategy, each typed against its narrowed options. */
type StrategyResolvers = {
  [K in McpAuthOptions['strategy']]: (
    options: Extract<McpAuthOptions, { strategy: K }>,
  ) => ResolvedAuth;
};

const STRATEGIES: StrategyResolvers = {
  verifier: (options) => ({
    mount() {},
    async gate(c) {
      const token = bearerToken(c);
      if (!token) return unauthorized(c, 'Missing bearer token');
      const identity = await options.verifyToken(token, c);
      if (!identity) return unauthorized(c, 'Invalid token');
      (c.set as (key: string, value: unknown) => void)('auth', identity as Identity);
      return undefined;
    },
  }),

  middleware: (options) => {
    const middleware = Array.isArray(options.middleware)
      ? options.middleware
      : [options.middleware];
    return { mount() {}, gate: (c) => runGate(c, middleware) };
  },

  oauth: (options) => ({
    mount(app) {
      app.route(options.mountPath ?? '/', options.router);
    },
    gate: (c) => runGate(c, [options.bearer]),
  }),
};

export function resolveAuth(options?: McpAuthOptions): ResolvedAuth {
  if (!options) return NO_AUTH;
  // TS can't correlate the discriminant key with its value type at a dynamic
  // index, so the dispatch needs one localized cast; each resolver is fully
  // typed against its narrowed options via StrategyResolvers.
  const resolver = STRATEGIES[options.strategy] as (o: McpAuthOptions) => ResolvedAuth;
  return resolver(options);
}
