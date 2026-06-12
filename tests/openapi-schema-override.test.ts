/**
 * OpenAPI route-schema overrides must genuinely apply on every definition
 * surface (class / functional / builder / config).
 *
 * Previously each endpoint's `getSchema()` spread `...this.schema` FIRST and
 * then assigned the generated `request`/`responses` blocks, so user-supplied
 * `responses`/`request` were silently discarded (the wide type was a no-op).
 * The shared `mergeRouteSchema` seam now merges user blocks OVER the
 * generated ones: a user-supplied 200 response and operationId win, while
 * untouched generated blocks (404, request params) survive.
 */
import { MemoryAdapters, MemoryReadEndpoint } from '@hono-crud/memory';
import { type OpenAPIRouteSchema, defineEndpoints, defineMeta, defineModel } from 'hono-crud';
import { crud } from 'hono-crud/builder';
import { createRead } from 'hono-crud/functional';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const WidgetModel = defineModel({
  tableName: 'openapi_override_widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});

const widgetMeta = defineMeta({ model: WidgetModel });

const customResponse = {
  description: 'Custom widget envelope',
  content: {
    'application/json': {
      schema: z.object({ widget: WidgetSchema }),
    },
  },
};

const overrides: Partial<OpenAPIRouteSchema> = {
  operationId: 'readWidgetCustom',
  responses: { 200: customResponse },
};

interface SchemaSource {
  getSchema(): OpenAPIRouteSchema;
}

function expectOverridesApplied(EndpointClass: new () => unknown): void {
  const schema = (new EndpointClass() as SchemaSource).getSchema();

  // User-supplied blocks win over the generated ones.
  expect(schema.operationId).toBe('readWidgetCustom');
  const responses = schema.responses as Record<number, { description: string }>;
  expect(responses[200].description).toBe('Custom widget envelope');

  // Untouched generated blocks survive the merge.
  expect(responses[404]).toBeDefined();
  expect(schema.request?.params).toBeDefined();
}

describe('OpenAPI schema overrides apply on all four surfaces', () => {
  it('class surface: schema property responses/operationId override the generated blocks', () => {
    class ClassRead extends MemoryReadEndpoint {
      _meta = widgetMeta;
      schema = { tags: ['Widgets'], ...overrides };
    }
    expectOverridesApplied(ClassRead as unknown as new () => unknown);
  });

  it('functional surface: schema config responses/operationId override the generated blocks', () => {
    const FnRead = createRead(
      { meta: widgetMeta, schema: { tags: ['Widgets'], ...overrides } },
      MemoryReadEndpoint,
    );
    expectOverridesApplied(FnRead as unknown as new () => unknown);
  });

  it('builder surface: .openapi() responses/operationId override the generated blocks', () => {
    const BuilderRead = crud(widgetMeta)
      .read()
      .tags('Widgets')
      .openapi(overrides)
      .build(MemoryReadEndpoint);
    expectOverridesApplied(BuilderRead as unknown as new () => unknown);
  });

  it('config surface: openapi responses/operationId override the generated blocks', () => {
    const endpoints = defineEndpoints(
      {
        meta: widgetMeta,
        read: { openapi: { tags: ['Widgets'], ...overrides } },
      },
      MemoryAdapters,
    );
    expectOverridesApplied(endpoints.read as unknown as new () => unknown);
  });
});
