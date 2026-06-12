import { ApiException } from 'hono-crud/internal';

/**
 * Exception thrown when `required: true` is configured and a mutating request
 * arrives without the idempotency key header.
 *
 * Flows through `createErrorHandler` (ErrorMappers / ErrorHooks / custom
 * `responseEnvelope`) like every other middleware exception; on bare Hono apps
 * it still serializes to the canonical envelope via `ApiException.getResponse()`.
 *
 * @example
 * ```ts
 * throw new IdempotencyKeyRequiredException('Idempotency-Key', 'POST');
 * ```
 */
export class IdempotencyKeyRequiredException extends ApiException {
  constructor(headerName = 'Idempotency-Key', method?: string) {
    super(
      `${headerName} header is required${method ? ` for ${method} requests` : ''}`,
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      { headerName, ...(method ? { method } : {}) },
    );
    this.name = 'IdempotencyKeyRequiredException';
  }
}

/**
 * Exception thrown when a request carries an idempotency key that is already
 * being processed by an in-flight request (lock held).
 *
 * @example
 * ```ts
 * throw new IdempotencyConflictException('my-key');
 * ```
 */
export class IdempotencyConflictException extends ApiException {
  constructor(idempotencyKey?: string) {
    super(
      'A request with this idempotency key is already being processed',
      409,
      'IDEMPOTENCY_CONFLICT',
      idempotencyKey !== undefined ? { idempotencyKey } : undefined,
    );
    this.name = 'IdempotencyConflictException';
  }
}
