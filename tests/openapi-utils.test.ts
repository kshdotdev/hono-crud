import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  jsonContent,
  jsonContentRequired,
  createErrorSchema,
  createOneOfErrorSchema,
  openApiValidationHook,
  createValidationHook,
  httpErrorContent,
  commonResponses,
  ZodIssueSchema,
  ZodErrorSchema,
  HttpErrorSchema,
} from '../src/openapi/utils.js';

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
// createErrorSchema() Tests
// ============================================================================

describe('createErrorSchema', () => {
  it('should return ZodErrorSchema regardless of input schema', () => {
    const userSchema = z.object({ name: z.string(), email: z.string() });
    const result = createErrorSchema(userSchema);

    expect(result).toBe(ZodErrorSchema);
  });

  it('should return a schema that validates error objects', () => {
    const schema = z.object({ id: z.number() });
    const errorSchema = createErrorSchema(schema);

    const validError = {
      success: false,
      error: {
        name: 'ZodError',
        issues: [
          { code: 'invalid_type', path: ['id'], message: 'Expected number' },
        ],
      },
    };

    expect(() => errorSchema.parse(validError)).not.toThrow();
  });

  it('should reject invalid error objects', () => {
    const schema = z.object({ id: z.number() });
    const errorSchema = createErrorSchema(schema);

    const invalidError = {
      success: true, // Should be false
      error: { name: 'ZodError', issues: [] },
    };

    expect(() => errorSchema.parse(invalidError)).toThrow();
  });
});

// ============================================================================
// createOneOfErrorSchema() Tests
// ============================================================================

describe('createOneOfErrorSchema', () => {
  it('should return ZodErrorSchema for multiple schemas', () => {
    const schema1 = z.object({ type: z.literal('a') });
    const schema2 = z.object({ type: z.literal('b') });
    const result = createOneOfErrorSchema(schema1, schema2);

    expect(result).toBe(ZodErrorSchema);
  });
});

// ============================================================================
// openApiValidationHook Tests
// ============================================================================

describe('openApiValidationHook', () => {
  it('should return 422 with ZodError format on validation failure', async () => {
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
              schema: z.object({
                name: z.string().min(1),
                age: z.number().int().positive(),
              }),
            },
          },
          required: true,
        },
      },
      responses: {
        200: jsonContent(z.object({ success: z.boolean() }), 'Success'),
      },
    });

    app.openapi(route, (c) => {
      return c.json({ success: true }, 200);
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', age: -5 }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.name).toBe('ZodError');
    expect(Array.isArray(data.error.issues)).toBe(true);
    expect(data.error.issues.length).toBeGreaterThan(0);
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

  it('should include all validation issues in response', async () => {
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
              schema: z.object({
                email: z.string().email(),
                age: z.number().min(0).max(150),
                role: z.enum(['admin', 'user']),
              }),
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
      body: JSON.stringify({ email: 'not-email', age: 200, role: 'invalid' }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.issues.length).toBe(3);
  });
});

// ============================================================================
// createValidationHook() Tests
// ============================================================================

describe('createValidationHook', () => {
  it('should create a custom validation hook with custom error format', async () => {
    const customHook = createValidationHook(
      (error) => ({
        message: 'Validation failed',
        errors: error.issues.map((i) => i.message),
      }),
      400
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

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toBe('Validation failed');
    expect(Array.isArray(data.errors)).toBe(true);
  });

  it('should use 422 as default status code', async () => {
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

    expect(res.status).toBe(422);
  });
});

// ============================================================================
// httpErrorContent() Tests
// ============================================================================

describe('httpErrorContent', () => {
  it('should create HTTP error content with HttpErrorSchema', () => {
    const result = httpErrorContent('Resource not found');

    expect(result.description).toBe('Resource not found');
    expect(result.content['application/json'].schema).toBe(HttpErrorSchema);
  });
});

// ============================================================================
// commonResponses Tests
// ============================================================================

describe('commonResponses', () => {
  it('should have all standard error responses', () => {
    expect(commonResponses.badRequest).toBeDefined();
    expect(commonResponses.unauthorized).toBeDefined();
    expect(commonResponses.forbidden).toBeDefined();
    expect(commonResponses.notFound).toBeDefined();
    expect(commonResponses.conflict).toBeDefined();
    expect(commonResponses.validationError).toBeDefined();
    expect(commonResponses.internalError).toBeDefined();
  });

  it('should have correct descriptions', () => {
    expect(commonResponses.badRequest.description).toBe('Bad request');
    expect(commonResponses.unauthorized.description).toBe('Unauthorized');
    expect(commonResponses.forbidden.description).toBe('Forbidden');
    expect(commonResponses.notFound.description).toBe('Resource not found');
    expect(commonResponses.conflict.description).toBe('Resource conflict');
    expect(commonResponses.validationError.description).toBe('Validation error');
    expect(commonResponses.internalError.description).toBe('Internal server error');
  });

  it('should use ZodErrorSchema for validationError', () => {
    expect(commonResponses.validationError.content['application/json'].schema).toBe(
      ZodErrorSchema
    );
  });

  it('should use HttpErrorSchema for other errors', () => {
    expect(commonResponses.badRequest.content['application/json'].schema).toBe(
      HttpErrorSchema
    );
    expect(commonResponses.notFound.content['application/json'].schema).toBe(
      HttpErrorSchema
    );
  });
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('ZodIssueSchema', () => {
  it('should validate a proper Zod issue', () => {
    const issue = {
      code: 'invalid_type',
      path: ['user', 'email'],
      message: 'Expected string, received number',
    };

    expect(() => ZodIssueSchema.parse(issue)).not.toThrow();
  });

  it('should accept numeric path elements', () => {
    const issue = {
      code: 'too_small',
      path: ['items', 0, 'quantity'],
      message: 'Number must be greater than 0',
    };

    expect(() => ZodIssueSchema.parse(issue)).not.toThrow();
  });
});

describe('ZodErrorSchema', () => {
  it('should validate a proper Zod error response', () => {
    const errorResponse = {
      success: false,
      error: {
        name: 'ZodError',
        issues: [
          { code: 'invalid_type', path: ['name'], message: 'Required' },
          { code: 'too_small', path: ['age'], message: 'Must be positive' },
        ],
      },
    };

    expect(() => ZodErrorSchema.parse(errorResponse)).not.toThrow();
  });

  it('should reject success: true', () => {
    const invalid = {
      success: true,
      error: { name: 'ZodError', issues: [] },
    };

    expect(() => ZodErrorSchema.parse(invalid)).toThrow();
  });

  it('should reject wrong error name', () => {
    const invalid = {
      success: false,
      error: { name: 'Error', issues: [] },
    };

    expect(() => ZodErrorSchema.parse(invalid)).toThrow();
  });
});

describe('HttpErrorSchema', () => {
  it('should validate a proper HTTP error response', () => {
    const errorResponse = {
      success: false,
      error: {
        message: 'Resource not found',
        code: 'NOT_FOUND',
      },
    };

    expect(() => HttpErrorSchema.parse(errorResponse)).not.toThrow();
  });

  it('should allow optional code field', () => {
    const errorResponse = {
      success: false,
      error: {
        message: 'Something went wrong',
      },
    };

    expect(() => HttpErrorSchema.parse(errorResponse)).not.toThrow();
  });
});
