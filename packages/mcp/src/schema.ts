import type { OpenAPIRouteSchema } from 'hono-crud/internal';
import { type ZodType, z } from 'zod';

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
  /** Whether the endpoint declares an `application/json` request body. */
  hasBody: boolean;
}

export function extractRequestPlan(route: OpenAPIRouteSchema): RequestPlan {
  return {
    paramKeys: Object.keys(shapeOf(route.request?.params)),
    queryKeys: Object.keys(shapeOf(route.request?.query)),
    hasBody: bodySchema(route) !== undefined,
  };
}

/**
 * Build the flat MCP `inputSchema` for a tool by merging the endpoint's path
 * params, query params and JSON body into a single object shape. The MCP SDK
 * converts this Zod shape to JSON Schema for the wire.
 */
export function buildInputShape(route: OpenAPIRouteSchema): RawShape {
  const merged: RawShape = {
    ...shapeOf(route.request?.params),
    ...shapeOf(route.request?.query),
    ...shapeOf(bodySchema(route)),
  };
  // The MCP SDK converts this shape to JSON Schema, and Zod cannot represent
  // `z.date()` — it throws ("Date cannot be represented in JSON Schema"),
  // breaking the entire `tools/list`. A date is carried on the wire as an ISO
  // 8601 string, so represent it as exactly that — Zod's own `z.iso.datetime()`,
  // which converts to `{ type: 'string', format: 'date-time' }`.
  const out: RawShape = {};
  for (const [key, schema] of Object.entries(merged)) {
    out[key] = datesAsIsoStrings(schema);
  }
  return out;
}

/**
 * Replace every `z.date()` in a schema with `z.iso.datetime()`, recursing
 * through optional / nullable / default / array / object wrappers. Schemas with
 * no date pass through by identity (no rebuild), so non-date fields keep their
 * exact shape/refinements. Dates are the only Zod type our endpoint schemas use
 * that the SDK's JSON-Schema conversion can't represent.
 */
function datesAsIsoStrings(schema: ZodType): ZodType {
  if (schema instanceof z.ZodDate) return z.iso.datetime();

  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap() as ZodType;
    const next = datesAsIsoStrings(inner);
    return next === inner ? schema : next.optional();
  }
  if (schema instanceof z.ZodNullable) {
    const inner = schema.unwrap() as ZodType;
    const next = datesAsIsoStrings(inner);
    return next === inner ? schema : next.nullable();
  }
  if (schema instanceof z.ZodDefault) {
    const def = schema.def as unknown as { innerType: ZodType; defaultValue: never };
    const next = datesAsIsoStrings(def.innerType);
    return next === def.innerType ? schema : next.default(def.defaultValue);
  }
  if (schema instanceof z.ZodArray) {
    const element = schema.element as ZodType;
    const next = datesAsIsoStrings(element);
    return next === element ? schema : z.array(next);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as RawShape;
    let changed = false;
    const next: RawShape = {};
    for (const [key, value] of Object.entries(shape)) {
      const mapped = datesAsIsoStrings(value);
      if (mapped !== value) changed = true;
      next[key] = mapped;
    }
    return changed ? z.object(next) : schema;
  }

  return schema;
}

type ResponseContent = { content?: Record<string, { schema?: unknown }> } | undefined;

/**
 * Whether the MCP SDK can serialize this shape for `tools/list`. The SDK
 * converts schemas with Zod's `toJSONSchema`, which throws on unrepresentable
 * types (e.g. `z.date()` in version-history responses) — probe the same
 * conversion here so such tools simply skip the output schema instead of
 * breaking the whole listing.
 */
function isJsonSchemaRepresentable(shape: RawShape): boolean {
  try {
    z.toJSONSchema(z.object(shape));
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive the MCP `outputSchema` shape from the endpoint's first 2xx response,
 * where derivable. A tool that declares an output schema MUST return
 * `structuredContent` on every success (the SDK enforces this), so the shape
 * is only derived when `application/json` is the response's sole declared
 * content type — an endpoint with a non-JSON alternative (e.g. export's CSV)
 * gets no output schema rather than a contract its CSV responses would break.
 * Shapes the SDK cannot represent in JSON Schema are skipped as well.
 */
export function buildOutputShape(route: OpenAPIRouteSchema): RawShape | undefined {
  const responses = route.responses as Record<string, ResponseContent> | undefined;
  if (!responses) return undefined;
  for (const [status, response] of Object.entries(responses)) {
    const code = Number(status);
    if (Number.isNaN(code) || code < 200 || code >= 300) continue;
    const content = response?.content;
    if (!content) return undefined;
    const contentTypes = Object.keys(content);
    if (contentTypes.length !== 1 || contentTypes[0] !== 'application/json') return undefined;
    const shape = shapeOf(content['application/json']?.schema);
    if (Object.keys(shape).length === 0) return undefined;
    return isJsonSchemaRepresentable(shape) ? shape : undefined;
  }
  return undefined;
}
