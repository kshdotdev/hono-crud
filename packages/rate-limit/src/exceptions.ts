import { ApiException } from 'hono-crud/internal';

/**
 * Exception thrown when rate limit is exceeded.
 *
 * @example
 * ```ts
 * throw new RateLimitExceededException('Too many requests', 60);
 * ```
 */
export class RateLimitExceededException extends ApiException {
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.name = 'RateLimitExceededException';
  }
}
