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

// Utilities
export {
  shouldRedact,
  redactObject,
  redactHeaders,
  matchPath,
  shouldExcludePath,
  extractClientIp,
  extractHeaders,
  extractQuery,
  extractUserId,
  truncateBody,
  isAllowedContentType,
  generateRequestId,
} from './utils';

// Middleware
export {
  createLoggingMiddleware,
  setLoggingStorage,
  getLoggingStorage,
  getRequestId,
  getRequestStartTime,
} from './middleware';

// Storage implementations
export { MemoryLoggingStorage } from './storage/memory';
export type { MemoryLoggingStorageOptions } from './storage/memory';
