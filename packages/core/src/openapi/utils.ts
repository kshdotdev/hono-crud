import type { Hook } from '@hono/zod-openapi';
import type { Env } from 'hono';
import type { z } from 'zod';
import { InputValidationException } from '../core/exceptions';

/**
 * Convert Express-style `:param` segments to OpenAPI `{param}` form.
 *
 * Single canonical implementation shared by the live router
 * (`HonoOpenAPIHandler`), per-tenant emission (`openapi/lazy.ts`) and pure
 * paths emission (`openapi/paths.ts`), so emitted OpenAPI path keys always
 * match the routes Hono actually serves.
 */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Creates a JSON content type definition for OpenAPI responses.
 * Simplifies defining response schemas with descriptions.
 *
 * @param schema - Zod schema for the response body
 * @param description - Description of the response
 * @returns Object with content type definition
 *
 * @example
 * ```ts
 * const UserResponse = z.object({
 *   id: z.string(),
 *   name: z.string(),
 * });
 *
 * // In route definition:
 * responses: {
 *   200: {
 *     content: jsonContent(UserResponse, 'User retrieved successfully'),
 *   },
 * }
 * ```
 */
export function jsonContent<T extends z.ZodSchema>(
  schema: T,
  description: string,
): {
  content: { 'application/json': { schema: T } };
  description: string;
} {
  return {
    content: {
      'application/json': { schema },
    },
    description,
  };
}

/**
 * Creates a required JSON content type definition for OpenAPI request bodies.
 * Same as jsonContent but marks the content as required.
 *
 * @param schema - Zod schema for the request body
 * @param description - Description of the request body
 * @returns Object with content type definition and required flag
 *
 * @example
 * ```ts
 * const CreateUserInput = z.object({
 *   name: z.string(),
 *   email: z.email(),
 * });
 *
 * // In route definition:
 * request: {
 *   body: jsonContentRequired(CreateUserInput, 'User data to create'),
 * },
 * ```
 */
export function jsonContentRequired<T extends z.ZodSchema>(
  schema: T,
  description: string,
): {
  content: { 'application/json': { schema: T } };
  description: string;
  required: true;
} {
  return {
    content: {
      'application/json': { schema },
    },
    description,
    required: true,
  };
}

/**
 * Canonical validation hook, installed automatically by `fromHono(...)` when
 * the app has no `defaultHook` of its own.
 *
 * On schema failure it throws `InputValidationException.fromZodError(...)`,
 * which serializes as the canonical 400 envelope:
 * `{ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation
 * failed', details: [{ path, message, code }] } }`.
 *
 * The throw propagates to `app.onError` — so apps wired with
 * `createErrorHandler` get per-route `responseEnvelope` composition and
 * `requestId` enrichment — while unwired apps fall back to
 * `ApiException.getResponse()`, which emits the same canonical JSON body.
 *
 * @example
 * ```ts
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { openApiValidationHook } from 'hono-crud';
 *
 * const app = new OpenAPIHono({
 *   defaultHook: openApiValidationHook,
 * });
 * ```
 */
export const openApiValidationHook: Hook<unknown, Env, '', unknown> = (result) => {
  if (!result.success) {
    throw InputValidationException.fromZodError(result.error);
  }
};

/**
 * Creates a custom validation hook with configurable error response.
 *
 * @param formatError - Function to format the error response
 * @param statusCode - HTTP status code for validation errors (default: 400)
 * @returns Hook function for validation
 *
 * @example
 * ```ts
 * const customHook = createValidationHook(
 *   (error) => ({
 *     message: 'Validation failed',
 *     errors: error.issues.map(i => i.message),
 *   }),
 *   422
 * );
 *
 * const app = new OpenAPIHono({
 *   defaultHook: customHook,
 * });
 * ```
 */
export function createValidationHook<T>(
  formatError: (error: z.ZodError) => T,
  statusCode: 400 | 422 = 400,
): Hook<unknown, Env, '', unknown> {
  return (result, c) => {
    if (!result.success) {
      return c.json(formatError(result.error), statusCode);
    }
  };
}

/**
 * Type helper for extracting the inferred type from a Zod schema.
 */
export type InferZodSchema<T extends z.ZodSchema> = z.infer<T>;
