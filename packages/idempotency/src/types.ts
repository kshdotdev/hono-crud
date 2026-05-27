/**
 * Stored idempotency response entry.
 */
export interface IdempotencyEntry {
  /** The idempotency key */
  key: string;
  /** HTTP status code of the cached response */
  statusCode: number;
  /** Serialized response body */
  body: string;
  /** Response headers to replay */
  headers: Record<string, string>;
  /** Timestamp when the entry was created */
  createdAt: number;
}

/**
 * Storage interface for idempotency keys.
 */
export interface IdempotencyStorage {
  /**
   * Get a stored idempotency entry.
   * Returns null if the key doesn't exist or has expired.
   */
  get(key: string): Promise<IdempotencyEntry | null>;

  /**
   * Store an idempotency entry with a TTL.
   * @param key - The idempotency key
   * @param entry - The response entry to store
   * @param ttlMs - Time-to-live in milliseconds
   */
  set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void>;

  /**
   * Check if a key is currently being processed (in-flight lock).
   * Used to prevent concurrent requests with the same key.
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Acquire a lock for a key being processed.
   * Returns true if the lock was acquired, false if already locked.
   */
  lock(key: string, ttlMs: number): Promise<boolean>;

  /**
   * Release a lock for a key.
   */
  unlock(key: string): Promise<void>;

  /**
   * Destroy the storage and clear all data.
   */
  destroy(): void;
}

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
   * Whether to require the idempotency key header.
   * If true, requests without the header will receive a 400 error.
   * If false, requests without the header are passed through normally.
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
