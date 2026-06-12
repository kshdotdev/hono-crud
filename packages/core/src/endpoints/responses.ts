/**
 * Shared OpenAPI response factories — the exported, doc-facing source of
 * truth for the canonical error envelope, plus the scaffolding shared by the
 * id-keyed batch verbs (`idsBodySchema` / `batchResultResponses`).
 *
 * Every endpoint declares the same `{ success: false, error: { code,
 * message, details? } }` envelope for its 4xx/5xx responses. These factories
 * are the single source of truth for that shape, replacing the ~28 inlined
 * copies that previously lived across the endpoint `getSchema()` methods.
 *
 * The shape is defined as the runtime `structuredErrorSchema`
 * (`core/types.ts`) minus the handler-enrichment fields (`requestId`/`stack`,
 * added only on the `createErrorHandler` onError path); the doc-schema ⊆
 * runtime-output relationship is enforced by the error-envelope contract
 * test.
 */

import { type ZodObject, type ZodRawShape, type ZodType, z } from 'zod';

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

/**
 * Request-body schema shared by the ids-keyed batch verbs (batch-delete /
 * batch-restore): `{ ids: string[] }` with 1..maxBatchSize entries.
 */
export function idsBodySchema(maxBatchSize: number): ZodObject<ZodRawShape> {
  return z.object({
    ids: z.array(z.string()).min(1).max(maxBatchSize),
  }) as unknown as ZodObject<ZodRawShape>;
}

/**
 * The 200 + 207 OpenAPI response pair shared by the three id-keyed batch
 * verbs (batch-delete / batch-restore / batch-update). The 200 result is
 * `{ [resultKey]: Model[], count, notFound? }`; the 207 adds the per-id
 * `errors` block. Spread into a `responses` map and add the verb-specific
 * 400 alongside.
 *
 * batch-create is intentionally NOT a consumer: its envelope genuinely
 * differs (201 success status, no `notFound`, errors keyed by `index:
 * number` rather than `id: string`). batch-upsert (200-only,
 * items/createdCount/updatedCount envelope) is likewise out of scope.
 */
export function batchResultResponses(
  resultKey: string,
  modelSchema: ZodType,
  successDescription: string,
) {
  const resultSchema = (withErrors: boolean) =>
    z.object({
      success: z.literal(true),
      result: z.object({
        [resultKey]: z.array(modelSchema),
        count: z.number(),
        notFound: z.array(z.string()).optional(),
        ...(withErrors
          ? {
              errors: z
                .array(
                  z.object({
                    id: z.string(),
                    error: z.string(),
                  }),
                )
                .optional(),
            }
          : {}),
      }),
    });

  return {
    200: {
      description: successDescription,
      content: {
        'application/json': { schema: resultSchema(false) },
      },
    },
    207: {
      description: 'Partial success (some items failed or not found)',
      content: {
        'application/json': { schema: resultSchema(true) },
      },
    },
  };
}
