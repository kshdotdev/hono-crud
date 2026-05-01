/**
 * Field redaction shared by logging/, audit/, and event/subscribe payload sanitization.
 */

export type RedactPattern = string | RegExp;

export function shouldRedact(fieldName: string, patterns: RedactPattern[]): boolean {
  const lower = fieldName.toLowerCase();
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      if (pattern.test(fieldName)) return true;
      continue;
    }
    const lp = pattern.toLowerCase();
    if (lp.includes('*')) {
      const re = lp.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${re}$`).test(lower)) return true;
    } else if (lower === lp) {
      return true;
    }
  }
  return false;
}

export function redactObject(obj: unknown, patterns: RedactPattern[]): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactObject(item, patterns));
  if (typeof obj !== 'object') return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (shouldRedact(key, patterns)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, patterns);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactHeaders(
  headers: Record<string, string>,
  patterns: RedactPattern[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = shouldRedact(key, patterns) ? '[REDACTED]' : value;
  }
  return result;
}
