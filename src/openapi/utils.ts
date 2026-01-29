import { z } from 'zod';
import type { Hook } from '@hono/zod-openapi';
import type { Env } from 'hono';

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
  description: string
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
  description: string
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
 * Schema for a single Zod validation issue.
 */
export const ZodIssueSchema = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/**
 * Schema for Zod validation error response.
 */
export const ZodErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    name: z.literal('ZodError'),
    issues: z.array(ZodIssueSchema),
  }),
});

/**
 * Creates an error schema showing what validation errors look like for a given schema.
 * Useful for documenting 422 responses in OpenAPI specs.
 *
 * @param schema - The Zod schema to create error documentation for
 * @returns Zod schema representing the validation error format
 *
 * @example
 * ```ts
 * const UserSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.email(),
 * });
 *
 * // In route definition:
 * responses: {
 *   422: {
 *     content: jsonContent(
 *       createErrorSchema(UserSchema),
 *       'Validation error'
 *     ),
 *   },
 * }
 * ```
 */
export function createErrorSchema<T extends z.ZodSchema>(
  _schema: T
): typeof ZodErrorSchema {
  // The error schema format is the same regardless of input schema
  // The input schema parameter allows TypeScript to infer documentation context
  return ZodErrorSchema;
}

/**
 * Creates an error schema for a one-of-many validation scenario.
 * This is useful when you have multiple possible schemas and want to show
 * the error format.
 *
 * @param schemas - Array of Zod schemas
 * @returns Zod schema representing the validation error format
 */
export function createOneOfErrorSchema<T extends z.ZodSchema[]>(
  ..._schemas: T
): typeof ZodErrorSchema {
  return ZodErrorSchema;
}

/**
 * Type for the validation hook result.
 */
export interface ValidationHookResult<E extends Env = Env> {
  success: false;
  error: z.ZodError;
}

/**
 * Default validation hook that returns 422 status on validation failure.
 * Use this as the defaultHook option when creating OpenAPI routes.
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
export const openApiValidationHook: Hook<unknown, Env, '', unknown> = (
  result,
  c
) => {
  if (!result.success) {
    return c.json(
      {
        success: false,
        error: {
          name: 'ZodError' as const,
          issues: result.error.issues,
        },
      },
      422
    );
  }
};

/**
 * Creates a custom validation hook with configurable error response.
 *
 * @param formatError - Function to format the error response
 * @param statusCode - HTTP status code for validation errors (default: 422)
 * @returns Hook function for validation
 *
 * @example
 * ```ts
 * const customHook = createValidationHook(
 *   (error) => ({
 *     message: 'Validation failed',
 *     errors: error.issues.map(i => i.message),
 *   }),
 *   400
 * );
 *
 * const app = new OpenAPIHono({
 *   defaultHook: customHook,
 * });
 * ```
 */
export function createValidationHook<T>(
  formatError: (error: z.ZodError) => T,
  statusCode: 400 | 422 = 422
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

/**
 * Common HTTP error response schema for 4xx/5xx errors.
 */
export const HttpErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
});

/**
 * Creates a generic HTTP error content definition.
 *
 * @param description - Description of the error response
 * @returns Object with content type definition
 */
export function httpErrorContent(description: string) {
  return jsonContent(HttpErrorSchema, description);
}

/**
 * Common error responses for reuse in OpenAPI definitions.
 */
export const commonResponses = {
  badRequest: httpErrorContent('Bad request'),
  unauthorized: httpErrorContent('Unauthorized'),
  forbidden: httpErrorContent('Forbidden'),
  notFound: httpErrorContent('Resource not found'),
  conflict: httpErrorContent('Resource conflict'),
  validationError: jsonContent(ZodErrorSchema, 'Validation error'),
  internalError: httpErrorContent('Internal server error'),
} as const;
