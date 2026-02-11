import type { FilterOperator, FilterCondition } from '../core/types';

// Re-export security config type for convenience
export type { AISecurityConfig } from './security/types';

// ============================================================================
// AI Model Types
// ============================================================================

/**
 * Minimal interface for a Vercel AI SDK LanguageModel.
 * Duck-typed to avoid coupling to a specific version of the `ai` package.
 */
export interface AILanguageModel {
  readonly modelId: string;
  readonly provider: string;
  doGenerate?: (...args: unknown[]) => unknown;
  doStream?: (...args: unknown[]) => unknown;
}

/**
 * Per-endpoint AI configuration overrides.
 */
export interface AIConfig {
  /** Override the global AI model for this endpoint */
  model?: AILanguageModel;
  /** Temperature for generation (0-2) */
  temperature?: number;
  /** Maximum tokens for the AI response */
  maxTokens?: number;
}

// ============================================================================
// NL Query Types
// ============================================================================

/**
 * Result of AI translation from natural language to structured filters.
 */
export interface NLTranslationResult {
  /** Generated filter conditions */
  filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  /** Sort configuration */
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  /** AI's confidence in the translation (0-1) */
  confidence: number;
  /** Human-readable interpretation of the query */
  interpretation: string;
}

/**
 * Validated filters after security checks.
 */
export interface ValidatedNLFilters {
  filters: FilterCondition[];
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
}

/**
 * NL Query response shape.
 */
export interface NLQueryResponse<T = unknown> {
  success: true;
  result: T[];
  result_info: {
    page: number;
    per_page: number;
    total_count?: number;
    total_pages?: number;
    has_next_page: boolean;
    has_prev_page: boolean;
  };
  query_info: {
    original_query: string;
    interpretation: string;
    confidence: number;
    applied_filters: FilterCondition[];
    applied_sort?: {
      field: string;
      direction: 'asc' | 'desc';
    };
  };
}

// ============================================================================
// RAG Types
// ============================================================================

/**
 * Configuration for the RAG endpoint.
 */
export interface RAGConfig {
  /** Which record fields to include in the AI context (default: all) */
  contextFields?: string[];
  /** Maximum number of records to include in context (default: 50) */
  maxContextRecords?: number;
  /** Maximum character length for the context string (default: 8000) */
  maxContextLength?: number;
  /** Include retrieval info (filters, record count) in response */
  includeRetrievalInfo?: boolean;
}

/**
 * RAG response shape.
 */
export interface RAGResponse {
  success: true;
  result: {
    answer: string;
    sources: Array<Record<string, unknown>>;
    retrieval_info?: {
      total_records: number;
      records_used: number;
    };
  };
}

// ============================================================================
// Field Description Types (for prompt building)
// ============================================================================

/**
 * Description of a single field for AI prompt context.
 */
export interface FieldDescription {
  name: string;
  type: string;
  operators: FilterOperator[];
}
