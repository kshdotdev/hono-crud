import type { RedactField } from './types';
import { redactObject } from '../../logging/utils';

// ============================================================================
// Default PII Patterns
// ============================================================================

export const DEFAULT_PII_PATTERNS: RedactField[] = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'ssn',
  'social_security*',
  'credit_card*',
  'card_number*',
  '*_secret',
  '*_token',
  '*_password',
];

// ============================================================================
// PII Redaction for AI Context
// ============================================================================

/**
 * Redact PII fields from records before they are included in AI context.
 * Uses the same glob/regex pattern matching as the logging redaction utilities.
 *
 * @param records - Array of records to redact
 * @param patterns - Field patterns to redact (defaults to DEFAULT_PII_PATTERNS)
 * @returns New array with sensitive fields replaced by '[REDACTED]'
 */
export function redactPIIFromRecords(
  records: Record<string, unknown>[],
  patterns?: RedactField[]
): Record<string, unknown>[] {
  const effectivePatterns = patterns ?? DEFAULT_PII_PATTERNS;
  return records.map(
    (record) => redactObject(record, effectivePatterns) as Record<string, unknown>
  );
}
