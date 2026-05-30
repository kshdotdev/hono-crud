import {
  ApiException,
  errorEnvelopeSchema,
  NotFoundException,
  structuredErrorSchema,
  successEnvelopeSchema,
} from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Locks the single-source error/success envelope contract: the same Zod schema
// that documents OpenAPI 4xx/5xx responses and types `ErrorResponse` also
// validates what `ApiException.toJSON()` actually emits. If the shape drifts,
// this fails.
describe('error envelope single source', () => {
  it('ApiException.toJSON() satisfies errorEnvelopeSchema', () => {
    const body = new ApiException('User not found', 404, 'NOT_FOUND').toJSON();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('User not found');
  });

  it('a built-in exception subclass also satisfies the envelope schema', () => {
    const body = new NotFoundException('User').toJSON();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('carries structured details when provided', () => {
    const body = new ApiException('Boom', 422, 'VALIDATION_ERROR', { field: 'email' }).toJSON();
    const parsed = errorEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('structuredErrorSchema requires code + message and rejects malformed errors', () => {
    expect(structuredErrorSchema.safeParse({ code: 'X', message: 'y' }).success).toBe(true);
    expect(structuredErrorSchema.safeParse({ code: 'X' }).success).toBe(false);
    expect(structuredErrorSchema.safeParse({ message: 'y' }).success).toBe(false);
  });

  it('successEnvelopeSchema builds a matching { success: true, result } schema', () => {
    const schema = successEnvelopeSchema(z.object({ id: z.string() }));
    expect(schema.safeParse({ success: true, result: { id: 'a' } }).success).toBe(true);
    expect(schema.safeParse({ success: false, result: { id: 'a' } }).success).toBe(false);
  });
});
