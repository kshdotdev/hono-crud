import { HTTPException } from 'hono/http-exception';
import type { ZodError } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Valid HTTP status codes for API exceptions.
 * Uses Hono's ContentfulStatusCode which excludes informational codes (1xx).
 */
export type ApiStatusCode = ContentfulStatusCode;

/**
 * Base API exception that extends Hono's HTTPException.
 * Provides structured error responses with code, message, and optional details.
 *
 * @example
 * ```ts
 * throw new ApiException('Something went wrong', 500, 'INTERNAL_ERROR');
 * throw new ApiException('Invalid input', 400, 'VALIDATION_ERROR', { field: 'email' });
 * ```
 */
export class ApiException extends HTTPException {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    status: ApiStatusCode = 500,
    code: string = 'INTERNAL_ERROR',
    details?: unknown
  ) {
    super(status, { message });
    this.name = 'ApiException';
    this.code = code;
    this.details = details;
  }

  /**
   * Converts the exception to a JSON response object.
   * Maintains backwards compatibility with existing error handling.
   */
  toJSON() {
    const errorObj: { code: string; message: string; details?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.details) {
      errorObj.details = this.details;
    }
    return {
      success: false as const,
      error: errorObj,
    };
  }

  /**
   * Gets the HTTP status code.
   * Alias for compatibility with code expecting 'status' property.
   */
  get statusCode(): ApiStatusCode {
    return this.status;
  }
}

export class InputValidationException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'InputValidationException';
  }

  static fromZodError(error: ZodError): InputValidationException {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return new InputValidationException('Validation failed', issues);
  }
}

export class NotFoundException extends ApiException {
  constructor(resource: string = 'Resource', _id?: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends ApiException {
  constructor(message: string = 'Resource already exists', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
    this.name = 'ConflictException';
  }
}

export class UnauthorizedException extends ApiException {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends ApiException {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenException';
  }
}

export class AggregationException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'AGGREGATION_ERROR', details);
    this.name = 'AggregationException';
  }
}

export class CacheException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 500, 'CACHE_ERROR', details);
    this.name = 'CacheException';
  }
}

export class ConfigurationException extends ApiException {
  constructor(message: string, details?: unknown) {
    super(message, 500, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationException';
  }
}
