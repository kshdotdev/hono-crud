// Base endpoint classes
export { NLQueryEndpoint } from './nl-query/endpoint';
export { RAGEndpoint } from './rag/endpoint';

// AI model management
export { setAIModel, getAIModel, resolveAIModel, validateAIModel } from './provider';

// Prompt builders (for customization)
export { buildNLQuerySystemPrompt } from './nl-query/prompt';
export { buildRAGSystemPrompt } from './rag/prompt';

// Utilities
export { buildFieldDescriptions } from './nl-query/parser';
export { buildRecordContext } from './rag/context-builder';

// Security
export { detectInjection } from './security/injection';
export { redactPIIFromRecords, DEFAULT_PII_PATTERNS } from './security/pii';
export {
  setAIAuditStorage,
  getAIAuditStorage,
  resetAIAuditStorage,
  MemoryAIAuditLogStorage,
} from './security/audit';

// Types
export type {
  AILanguageModel,
  AIConfig,
  AISecurityConfig,
  NLTranslationResult,
  ValidatedNLFilters,
  NLQueryResponse,
  RAGConfig,
  RAGResponse,
  FieldDescription,
} from './types';

export type {
  InjectionDetectionConfig,
  InjectionDetectionResult,
  InjectionPattern,
  AIAuditLogEntry,
  AIAuditLogStorage,
} from './security/types';
