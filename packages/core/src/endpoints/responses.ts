/**
 * Shared OpenAPI error-response factories.
 *
 * Every endpoint declares the same `{ success: false, error: { code,
 * message, details? } }` envelope for its 4xx/5xx responses. These factories
 * are the single source of truth for that shape, replacing the ~28 inlined
 * copies that previously lived across the endpoint `getSchema()` methods.
 */

import { type ZodObject, z } from 'zod';

/** The error-envelope Zod object: `{ success: false, error: {...} }`. */
export function errorResponseZodSchema(): ZodObject<{
  success: z.ZodLiteral<false>;
  error: ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
  }>;
}> {
  return z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  });
}

/**
 * A complete OpenAPI response object for the error envelope — drop straight
 * into a `responses` map: `400: errorResponseSchema('Validation error')`.
 */
export function errorResponseSchema(description?: string) {
  return {
    description: description ?? 'Error',
    content: {
      'application/json': { schema: errorResponseZodSchema() },
    },
  };
}

/**
 * Build several error responses at once from a `{ status: description }` map:
 * `...errorResponses({ 400: 'Validation error', 404: 'Not found' })`.
 */
export function errorResponses(
  map: Record<number, string>,
): Record<number, ReturnType<typeof errorResponseSchema>> {
  const out: Record<number, ReturnType<typeof errorResponseSchema>> = {};
  for (const [status, description] of Object.entries(map)) {
    out[Number(status)] = errorResponseSchema(description);
  }
  return out;
}
