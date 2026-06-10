import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { createErrorHandler } from 'hono-crud';
import {
  createValidationHook,
  jsonContent,
  jsonContentRequired,
  openApiValidationHook,
} from 'hono-crud/openapi/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ============================================================================
// jsonContent() Tests
// ============================================================================

describe('jsonContent', () => {
  it('should create a content object with application/json schema', () => {
    const schema = z.object({ id: z.string(), name: z.string() });
    const result = jsonContent(schema, 'User data');

    expect(result.description).toBe('User data');
    expect(result.content).toBeDefined();
    expect(result.content['application/json']).toBeDefined();
    expect(result.content['application/json'].schema).toBe(schema);
  });

  it('should work with primitive schemas', () => {
    const schema = z.string();
    const result = jsonContent(schema, 'A string value');

    expect(result.description).toBe('A string value');
    expect(result.content['application/json'].schema).toBe(schema);
  });

  it('should work with array schemas', () => {
    const schema = z.array(z.object({ id: z.number() }));
    const result = jsonContent(schema, 'List of items');

    expect(result.description).toBe('List of items');
    expect(result.content['application/json'].schema).toBe(schema);
  });

  it('should work with union schemas', () => {
    const schema = z.union([z.string(), z.number()]);
    const result = jsonContent(schema, 'String or number');

    expect(result.description).toBe('String or number');
    expect(result.content['application/json'].schema).toBe(schema);
  });

  it('should not include required flag', () => {
    const schema = z.object({ id: z.string() });
    const result = jsonContent(schema, 'Test');

    expect((result as Record<string, unknown>).required).toBeUndefined();
  });
});

// ============================================================================
// jsonContentRequired() Tests
// ============================================================================

describe('jsonContentRequired', () => {
  it('should create a required content object', () => {
    const schema = z.object({ name: z.string(), email: z.string().email() });
    const result = jsonContentRequired(schema, 'User input');

    expect(result.description).toBe('User input');
    expect(result.required).toBe(true);
    expect(result.content['application/json'].schema).toBe(schema);
  });

  it('should always have required: true', () => {
    const schema = z.object({});
    const result = jsonContentRequired(schema, 'Empty object');

    expect(result.required).toBe(true);
  });
});

// ============================================================================
// openApiValidationHook Tests
// ============================================================================

/** Builds an app with the canonical validation hook and a single POST /test route. */
function buildHookApp(schema: z.ZodObject<z.ZodRawShape>): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: openApiValidationHook,
  });

  const route = createRoute({
    method: 'post',
    path: '/test',
    request: {
      body: {
        content: {
          'application/json': { schema },
        },
        required: true,
      },
    },
    responses: {
      200: jsonContent(z.object({ ok: z.boolean() }), 'Success'),
    },
  });

  app.openapi(route, (c) => c.json({ ok: true }, 200));
  return app;
}

describe('openApiValidationHook', () => {
  it('should return 400 with the canonical envelope on validation failure (unwired app → getResponse fallback)', async () => {
    // No app.onError wiring: the thrown InputValidationException is rendered
    // by ApiException.getResponse() and must still be the canonical envelope.
    const app = buildHookApp(
      z.object({
        name: z.string().min(1),
        age: z.number().int().positive(),
      }),
    );

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', age: -5 }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toBe('Validation failed');
    expect(Array.isArray(data.error.details)).toBe(true);
    expect(data.error.details.length).toBeGreaterThan(0);
    for (const issue of data.error.details) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
      expect(typeof issue.code).toBe('string');
    }
  });

  it('should return the same canonical envelope through createErrorHandler (wired app)', async () => {
    const app = buildHookApp(
      z.object({
        name: z.string().min(1),
      }),
    );
    app.onError(createErrorHandler());

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toBe('Validation failed');
    expect(Array.isArray(data.error.details)).toBe(true);
  });

  it('should pass through on successful validation', async () => {
    const app = new OpenAPIHono({
      defaultHook: openApiValidationHook,
    });

    const route = createRoute({
      method: 'post',
      path: '/test',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ name: z.string() }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ received: z.string() }), 'Success'),
      },
    });

    app.openapi(route, (c) => {
      const data = c.req.valid('json');
      return c.json({ received: data.name }, 200);
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe('Alice');
  });

  it('should include all validation issues in details', async () => {
    const app = buildHookApp(
      z.object({
        email: z.string().email(),
        age: z.number().min(0).max(150),
        role: z.enum(['admin', 'user']),
      }),
    );

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-email', age: 200, role: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details.length).toBe(3);
  });
});

// ============================================================================
// createValidationHook() Tests
// ============================================================================

describe('createValidationHook', () => {
  it('should create a custom validation hook with custom error format and explicit status code', async () => {
    const customHook = createValidationHook(
      (error) => ({
        message: 'Validation failed',
        errors: error.issues.map((i) => i.message),
      }),
      422,
    );

    const app = new OpenAPIHono({
      defaultHook: customHook,
    });

    const route = createRoute({
      method: 'post',
      path: '/test',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ name: z.string().min(5) }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ ok: z.boolean() }), 'Success'),
      },
    });

    app.openapi(route, (c) => c.json({ ok: true }, 200));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ab' }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.message).toBe('Validation failed');
    expect(Array.isArray(data.errors)).toBe(true);
  });

  it('should use 400 as default status code', async () => {
    const customHook = createValidationHook((error) => ({
      failed: true,
      count: error.issues.length,
    }));

    const app = new OpenAPIHono({
      defaultHook: customHook,
    });

    const route = createRoute({
      method: 'post',
      path: '/test',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ value: z.number() }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ ok: z.boolean() }), 'Success'),
      },
    });

    app.openapi(route, (c) => c.json({ ok: true }, 200));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'not a number' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.failed).toBe(true);
  });
});
