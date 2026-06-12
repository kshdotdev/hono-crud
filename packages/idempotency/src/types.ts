import type { IdempotencyStorage } from 'hono-crud/internal';

/**
 * The cross-package idempotency storage contract is owned by core
 * (`storage/contracts.ts`) and re-exported here so plugin consumers keep
 * importing `IdempotencyStorage` / `IdempotencyEntry` from this package.
 * `destroy?()` and `cleanup?()` are part of that shared optional contract.
 */
export type { IdempotencyStorage, IdempotencyEntry } from 'hono-crud/internal';

/**
 * Configuration for idempotency middleware.
 */
export interface IdempotencyConfig {
  /**
   * Header name for the idempotency key.
   * @default 'Idempotency-Key'
   */
  headerName?: string;

  /**
   * TTL for stored responses in seconds.
   * @default 86400 (24 hours)
   */
  ttl?: number;

  /**
   * HTTP methods that require idempotency keys.
   * @default ['POST']
   */
  enforcedMethods?: string[];

  /**
   * Whether the idempotency guarantee is mandatory for enforced methods.
   *
   * If true:
   * - requests without the header throw `IdempotencyKeyRequiredException`
   *   (400 IDEMPOTENCY_KEY_REQUIRED), and
   * - a missing/unresolvable storage throws `ConfigurationException` instead
   *   of silently passing through (a mis-wired storage must not silently void
   *   replay protection).
   *
   * If false (the default), requests without the header pass through
   * normally, and a missing storage logs a once-per-isolate warning and
   * passes through.
   * @default false
   */
  required?: boolean;

  /**
   * Lock timeout in seconds for in-flight requests.
   * @default 60
   */
  lockTimeout?: number;

  /**
   * Custom storage instance.
   * If not provided, uses the global idempotency storage.
   */
  storage?: IdempotencyStorage;
}
