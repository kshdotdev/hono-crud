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

// Types
export type { IdempotencyConfig, IdempotencyStorage, IdempotencyEntry } from './types';
