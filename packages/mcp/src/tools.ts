import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hono } from 'hono';
import { getLogger } from 'hono-crud';
import { ConfigurationException } from 'hono-crud/internal';
import { defaultDescription, defaultNaming, resolveAnnotations } from './config';
import {
  type DispatchTarget,
  type ForwardHeaders,
  type ToolCallResult,
  dispatch,
  toToolResult,
} from './dispatch';
import { buildInputShape, extractRequestPlan } from './schema';
import {
  type CrudMcpOptions,
  type EndpointInstance,
  OPERATIONS,
  type ResourceEndpoints,
  type ResourceOptions,
  type ToolAnnotations,
} from './types';

type ToolExtra = { requestInfo?: { headers?: ForwardHeaders } };

/**
 * Adapter over `McpServer.registerTool`. The SDK's signature is heavily generic
 * over the input schema; we drive it dynamically from runtime Zod shapes, so we
 * narrow to the shape we actually use via one localized cast.
 */
type RegisterTool = (
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
  },
  cb: (args: Record<string, unknown>, extra: ToolExtra) => Promise<ToolCallResult>,
) => unknown;

function resourceLabel(path: string, instance: EndpointInstance, override?: string): string {
  if (override) return override;
  const tag = instance._meta?.model?.tag ?? instance._meta?.model?.tableName;
  if (tag) return tag;
  const segment = path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .pop();
  return segment || 'resource';
}

function headersFrom(extra: ToolExtra): ForwardHeaders | undefined {
  return extra.requestInfo?.headers;
}

/**
 * Instantiate each enabled CRUD endpoint, read its schema, and register a
 * matching MCP tool whose handler re-dispatches into the Hono app.
 * Returns the registered tool names.
 */
export function registerResourceTools(
  server: McpServer,
  // biome-ignore lint/suspicious/noExplicitAny: re-dispatch targets any Hono app.
  app: Hono<any, any, any>,
  basePath: string,
  endpoints: ResourceEndpoints,
  options: CrudMcpOptions,
  resourceOptions: ResourceOptions = {},
): string[] {
  const normalizedPath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const naming = options.naming ?? defaultNaming;
  const requested = resourceOptions.operations ?? OPERATIONS;
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  const registered: string[] = [];

  for (const operation of OPERATIONS) {
    if (!requested.includes(operation)) continue;

    const Endpoint = endpoints[operation];
    if (!Endpoint) continue;

    const toolOptions = resourceOptions.tools?.[operation] ?? {};
    if (toolOptions.enabled === false) continue;

    let instance: EndpointInstance;
    try {
      instance = new (Endpoint as new () => EndpointInstance)();
    } catch (err) {
      throw new ConfigurationException(
        `@hono-crud/mcp: failed to instantiate the "${operation}" endpoint for "${normalizedPath}". Endpoints must be constructible with no arguments. ${(err as Error).message}`,
      );
    }

    const route = instance.getSchema();
    const resource = resourceLabel(normalizedPath, instance, resourceOptions.name);
    const toolName = toolOptions.name ?? naming({ resource, operation });
    const description =
      toolOptions.description ??
      defaultDescription(resource, operation, resourceOptions.description);
    const target: DispatchTarget = {
      operation,
      basePath: normalizedPath,
      plan: extractRequestPlan(route),
    };

    register(
      toolName,
      {
        description,
        inputSchema: buildInputShape(route),
        annotations: resolveAnnotations(operation, toolOptions.annotations),
      },
      async (args, extra) => {
        try {
          const res = await dispatch(app, target, args ?? {}, headersFrom(extra));
          return await toToolResult(res);
        } catch (err) {
          getLogger().error('@hono-crud/mcp tool dispatch failed', {
            tool: toolName,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            content: [{ type: 'text', text: `Tool execution failed: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );

    registered.push(toolName);
  }

  return registered;
}
