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
  constructor(message: string = 'Too many requests', retryAfter: number = 60) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.name = 'RateLimitExceededException';
  }
}
