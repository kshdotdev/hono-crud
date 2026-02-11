import type {
  InjectionDetectionConfig,
  InjectionDetectionResult,
  InjectionPattern,
} from './types';

// ============================================================================
// Built-in Injection Patterns
// ============================================================================

const BUILTIN_PATTERNS: InjectionPattern[] = [
  // System prompt override (weight: 1.0)
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|context)/i,
    weight: 1.0,
    category: 'system_prompt_override',
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i,
    weight: 1.0,
    category: 'system_prompt_override',
  },
  {
    pattern: /new\s+system\s+prompt/i,
    weight: 1.0,
    category: 'system_prompt_override',
  },
  {
    pattern: /override\s+(system|initial)\s+(prompt|instructions|message)/i,
    weight: 1.0,
    category: 'system_prompt_override',
  },
  {
    pattern: /forget\s+(all\s+)?(your|previous|prior)\s+(instructions|rules|programming)/i,
    weight: 1.0,
    category: 'system_prompt_override',
  },

  // Role hijacking (weight: 0.9)
  {
    pattern: /you\s+are\s+now\s+(a|an|the)\b/i,
    weight: 0.9,
    category: 'role_hijacking',
  },
  {
    pattern: /act\s+as\s+(a|an|if|though)\b/i,
    weight: 0.9,
    category: 'role_hijacking',
  },
  {
    pattern: /pretend\s+(you\s+are|to\s+be|you're)\b/i,
    weight: 0.9,
    category: 'role_hijacking',
  },
  {
    pattern: /switch\s+to\s+(developer|admin|debug|god)\s+mode/i,
    weight: 0.9,
    category: 'role_hijacking',
  },
  {
    pattern: /enter\s+(developer|admin|debug|god|jailbreak)\s+mode/i,
    weight: 0.9,
    category: 'role_hijacking',
  },
  {
    pattern: /from\s+now\s+on\s+you\s+(will|must|should|are)/i,
    weight: 0.9,
    category: 'role_hijacking',
  },

  // Data exfiltration (weight: 0.8)
  {
    pattern: /output\s+(all|every|the\s+entire)\s+(records?|data|database|entries)/i,
    weight: 0.8,
    category: 'data_exfiltration',
  },
  {
    pattern: /show\s+(me\s+)?(the\s+)?(system\s+prompt|your\s+instructions|your\s+rules)/i,
    weight: 0.8,
    category: 'data_exfiltration',
  },
  {
    pattern: /reveal\s+(the\s+)?(system\s+prompt|your\s+instructions|your\s+programming|hidden)/i,
    weight: 0.8,
    category: 'data_exfiltration',
  },
  {
    pattern: /dump\s+(all|the)\s+(data|records|tables|database)/i,
    weight: 0.8,
    category: 'data_exfiltration',
  },
  {
    pattern: /what\s+(are|is)\s+your\s+(system\s+prompt|instructions|rules|programming)/i,
    weight: 0.8,
    category: 'data_exfiltration',
  },

  // Delimiter injection (weight: 0.7)
  {
    pattern: /<\/?system>/i,
    weight: 0.7,
    category: 'delimiter_injection',
  },
  {
    pattern: /<\/?(?:assistant|user|human|ai)\s*>/i,
    weight: 0.7,
    category: 'delimiter_injection',
  },
  {
    pattern: /\[INST\]|\[\/INST\]/i,
    weight: 0.7,
    category: 'delimiter_injection',
  },
  {
    pattern: /```\s*system\b/i,
    weight: 0.7,
    category: 'delimiter_injection',
  },
  {
    pattern: /={3,}\s*(?:SYSTEM|INSTRUCTIONS|PROMPT)\s*={3,}/i,
    weight: 0.7,
    category: 'delimiter_injection',
  },

  // Encoding attacks (weight: 0.6)
  {
    pattern: /[\u200B-\u200F\u2028-\u202F\uFEFF]/,
    weight: 0.6,
    category: 'encoding_attack',
  },
  {
    pattern: /(?:base64|atob|btoa)\s*\(/i,
    weight: 0.6,
    category: 'encoding_attack',
  },
  {
    pattern: /eval\s*\(/i,
    weight: 0.6,
    category: 'encoding_attack',
  },
];

// ============================================================================
// Detection Function
// ============================================================================

/**
 * Detect potential prompt injection attacks in user input.
 * Uses pattern-based matching with weighted risk scoring.
 *
 * @returns Detection result with flagged status, risk score, and matched categories
 */
export function detectInjection(
  input: string,
  config?: InjectionDetectionConfig
): InjectionDetectionResult {
  if (config?.disabled) {
    return { flagged: false, riskScore: 0, matchedCategories: [] };
  }

  const threshold = config?.threshold ?? 0.7;
  const trimmed = input.trim();

  if (!trimmed) {
    return { flagged: false, riskScore: 0, matchedCategories: [] };
  }

  const allPatterns = config?.additionalPatterns
    ? [...BUILTIN_PATTERNS, ...config.additionalPatterns]
    : BUILTIN_PATTERNS;

  let highestWeight = 0;
  const matchedCategories = new Set<string>();

  for (const { pattern, weight, category } of allPatterns) {
    if (pattern.test(trimmed)) {
      matchedCategories.add(category);
      if (weight > highestWeight) {
        highestWeight = weight;
      }
    }
  }

  return {
    flagged: highestWeight >= threshold,
    riskScore: highestWeight,
    matchedCategories: [...matchedCategories],
  };
}
