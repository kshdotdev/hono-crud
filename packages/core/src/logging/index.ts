// Types
export type {
  LogLevel,
  RequestLogEntry,
  ResponseLogEntry,
  LogEntry,
  LogQueryOptions,
  LoggingStorage,
  PathPattern,
  RedactField,
  RequestBodyConfig,
  ResponseBodyConfig,
  LoggingConfig,
  LoggingEnv,
} from './types';

// Utilities (logging-owned)
export {
  extractHeaders,
  extractQuery,
  isAllowedContentType,
  shouldExcludePath,
  truncateBody,
} from './utils';

// Shared canonical helpers, re-exported so every name this barrel has
// always offered keeps resolving. `extractClientIp`/`extractUserId` are
// aliases of the canonical `getClientIp`/`getUserId` accessors.
export { generateRequestId } from '../utils/context';
export { matchPath } from '../utils/path-match';
export { redactHeaders, redactObject, shouldRedact } from '../utils/redact';
export {
  getClientIp as extractClientIp,
  getUserId as extractUserId,
} from '../utils/request-info';

// Middleware + storage feature (set/get/getRequired/resolve quartet + registry)
export {
  createLoggingMiddleware,
  loggingStorageRegistry,
  setLoggingStorage,
  getLoggingStorage,
  getLoggingStorageRequired,
  resolveLoggingStorage,
  getRequestId,
  getRequestStartTime,
} from './middleware';

// Storage implementations
export { MemoryLoggingStorage } from './storage/memory';
export type { MemoryLoggingStorageOptions } from './storage/memory';
