// Middleware + storage feature (set/get/getRequired/resolve quartet + registry)
export {
  createIdempotencyMiddleware,
  idempotencyStorageRegistry,
  setIdempotencyStorage,
  getIdempotencyStorage,
  getIdempotencyStorageRequired,
  resolveIdempotencyStorage,
} from './middleware';

// Exceptions
export { IdempotencyKeyRequiredException, IdempotencyConflictException } from './exceptions';

// Storage implementations
export { MemoryIdempotencyStorage } from './storage/memory';
export type { MemoryIdempotencyStorageOptions } from './storage/memory';
export { RedisIdempotencyStorage } from './storage/redis';
export type { RedisIdempotencyClient, RedisIdempotencyStorageOptions } from './storage/redis';
// Cloudflare Durable Objects — the edge-native backend (atomic lock via DO CAS).
export { DOIdempotencyStorage, IdempotencyDurableObject } from './storage/durable-object';
export type { DOIdempotencyStorageOptions } from './storage/durable-object';

// Types
export type { IdempotencyConfig, IdempotencyStorage, IdempotencyEntry } from './types';
