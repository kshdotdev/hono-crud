import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Context, Hono } from 'hono';
import { ConfigurationException } from 'hono-crud/internal';
import { type ResolvedAuth, resolveAuth } from './auth';
import { registerResourceTools } from './tools';
import type { CrudMcpOptions, ResourceEndpoints, ResourceOptions } from './types';

/**
 * Exposes `hono-crud` resources as MCP tools over HTTP streaming transport.
 * Tool calls are re-dispatched into the mounted Hono app, so they share the
 * exact REST pipeline (auth, validation, hooks, serialization, pagination).
 */
export class CrudMcpServer {
  private readonly server: McpServer;
  private readonly transport: StreamableHTTPTransport;
  private readonly auth: ResolvedAuth;
  private readonly toolNames = new Set<string>();
  private connectPromise?: Promise<void>;

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: re-dispatch targets any Hono app.
    private readonly app: Hono<any, any, any>,
    private readonly options: CrudMcpOptions,
  ) {
    this.server = new McpServer(
      { name: options.name, version: options.version },
      options.instructions ? { instructions: options.instructions } : undefined,
    );
    this.transport = new StreamableHTTPTransport();
    this.auth = resolveAuth(options.auth);
    this.auth.mount(app);
  }

  /** Register MCP tools for a CRUD resource. `endpoints` is the same map passed to `registerCrud`. */
  resource(path: string, endpoints: ResourceEndpoints, options: ResourceOptions = {}): this {
    const names = registerResourceTools(
      this.server,
      this.app,
      path,
      endpoints,
      this.options,
      options,
    );
    for (const name of names) {
      if (this.toolNames.has(name)) {
        throw new ConfigurationException(
          `@hono-crud/mcp: duplicate tool name "${name}". Disambiguate with ResourceOptions.name, a custom naming strategy, or per-tool name overrides.`,
        );
      }
      this.toolNames.add(name);
    }
    return this;
  }

  /** Hono handler for the MCP endpoint. Mount with `app.all('/mcp', mcp.handler())`. */
  handler(): (c: Context) => Promise<Response | undefined> {
    return async (c: Context) => {
      const denied = await this.auth.gate(c);
      if (denied) return denied;
      await this.ensureConnected();
      return this.transport.handleRequest(c);
    };
  }

  private ensureConnected(): Promise<void> {
    if (!this.connectPromise) {
      this.connectPromise = this.server.connect(this.transport);
    }
    return this.connectPromise;
  }
}

/** Create an MCP server bound to a Hono app. See {@link CrudMcpServer}. */
export function createCrudMcp(
  // biome-ignore lint/suspicious/noExplicitAny: re-dispatch targets any Hono app.
  app: Hono<any, any, any>,
  options: CrudMcpOptions,
): CrudMcpServer {
  return new CrudMcpServer(app, options);
}
