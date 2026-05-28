import type { OpenAPIRouteSchema } from 'hono-crud';
import type { ZodType } from 'zod';

/** A flat MCP input schema: a map of field name to Zod schema. */
export type RawShape = Record<string, ZodType>;

type ShapeBearer = { shape?: RawShape | (() => RawShape) };

/** Read the `.shape` off a Zod object (v3 getter or v4 record), if present. */
function shapeOf(schema: unknown): RawShape {
  if (!schema || typeof schema !== 'object') return {};
  const shape = (schema as ShapeBearer).shape;
  const resolved = typeof shape === 'function' ? shape() : shape;
  return resolved && typeof resolved === 'object' ? resolved : {};
}

/** Pull the `application/json` body schema out of an OpenAPI request, if any. */
function bodySchema(route: OpenAPIRouteSchema): unknown {
  const body = route.request?.body as
    | { content?: Record<string, { schema?: unknown }> }
    | undefined;
  return body?.content?.['application/json']?.schema;
}

/** Field-name buckets used by dispatch to split a flat tool input into a request. */
export interface RequestPlan {
  paramKeys: string[];
  queryKeys: string[];
}

export function extractRequestPlan(route: OpenAPIRouteSchema): RequestPlan {
  return {
    paramKeys: Object.keys(shapeOf(route.request?.params)),
    queryKeys: Object.keys(shapeOf(route.request?.query)),
  };
}

/**
 * Build the flat MCP `inputSchema` for a tool by merging the endpoint's path
 * params, query params and JSON body into a single object shape. The MCP SDK
 * converts this Zod shape to JSON Schema for the wire.
 */
export function buildInputShape(route: OpenAPIRouteSchema): RawShape {
  return {
    ...shapeOf(route.request?.params),
    ...shapeOf(route.request?.query),
    ...shapeOf(bodySchema(route)),
  };
}
