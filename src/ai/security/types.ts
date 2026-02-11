import type { RedactField } from '../../logging/types';

// ============================================================================
// Injection Detection Types
// ============================================================================

export interface InjectionPattern {
  pattern: RegExp;
  weight: number;
  category: string;
}

export interface InjectionDetectionConfig {
  /** Risk score threshold above which input is flagged (0-1, default: 0.7) */
  threshold?: number;
  /** Action to take when injection is detected (default: 'block') */
  action?: 'block' | 'warn';
  /** Additional user-defined patterns */
  additionalPatterns?: InjectionPattern[];
  /** Disable injection detection entirely */
  disabled?: boolean;
}

export interface InjectionDetectionResult {
  /** Whether the input was flagged as a potential injection */
  flagged: boolean;
  /** Highest matched pattern weight (0-1) */
  riskScore: number;
  /** Categories of matched patterns */
  matchedCategories: string[];
}

// ============================================================================
// PII Redaction Types
// ============================================================================

export type { RedactField };

// ============================================================================
// Audit Logging Types
// ============================================================================

export interface AIAuditLogEntry {
  id: string;
  timestamp: string;
  endpoint: 'nl-query' | 'rag';
  input: string;
  status: 'success' | 'blocked' | 'error';
  durationMs: number;
  injectionDetected?: boolean;
  injectionScore?: number;
  confidence?: number;
  interpretation?: string;
  recordCount?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface AIAuditLogStorage {
  store(entry: AIAuditLogEntry): Promise<void>;
}

// ============================================================================
// Security Config (aggregated)
// ============================================================================

export interface AISecurityConfig {
  /** Injection detection configuration */
  injection?: InjectionDetectionConfig;
  /** PII field patterns to redact from AI context (overrides defaults) */
  piiPatterns?: RedactField[];
  /** Enable/disable PII redaction (default: true for RAG) */
  piiRedactionEnabled?: boolean;
}
