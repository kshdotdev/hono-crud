// Injection detection
export { detectInjection } from './injection';

// PII redaction
export { redactPIIFromRecords, DEFAULT_PII_PATTERNS } from './pii';

// Audit logging
export {
  setAIAuditStorage,
  getAIAuditStorage,
  resetAIAuditStorage,
  MemoryAIAuditLogStorage,
} from './audit';

// Types
export type {
  InjectionDetectionConfig,
  InjectionDetectionResult,
  InjectionPattern,
  AISecurityConfig,
  AIAuditLogEntry,
  AIAuditLogStorage,
  RedactField,
} from './types';
