/**
 * Search utilities for tokenization, scoring, and highlighting.
 */

import type { SearchFieldConfig, SearchMode } from '../core/types';

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Common stop words to filter out during tokenization.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with',
]);

/**
 * Tokenizes a string into normalized terms.
 *
 * @param text - The text to tokenize
 * @param removeStopWords - Whether to filter out common stop words
 * @returns Array of normalized tokens
 */
export function tokenize(text: string, removeStopWords: boolean = true): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Convert to lowercase, remove punctuation, split on whitespace
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (removeStopWords) {
    return tokens.filter(token => !STOP_WORDS.has(token) && token.length > 1);
  }

  return tokens;
}

/**
 * Tokenizes a search query based on mode.
 *
 * @param query - The search query
 * @param mode - Search mode ('any', 'all', 'phrase')
 * @returns Array of tokens or single phrase token for phrase mode
 */
export function tokenizeQuery(query: string, mode: SearchMode): string[] {
  if (mode === 'phrase') {
    // For phrase mode, keep the entire query as one token (normalized)
    return [query.toLowerCase().trim()];
  }
  return tokenize(query);
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Calculates term frequency (TF) for a term in a document.
 *
 * @param term - The term to count
 * @param tokens - Tokenized document
 * @returns Term frequency (count / total tokens)
 */
export function termFrequency(term: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const count = tokens.filter(t => t === term || t.includes(term)).length;
  return count / tokens.length;
}

/**
 * Calculates a simple relevance score for a record against a search query.
 * Uses TF-IDF-like scoring with field weights.
 *
 * @param record - The record to score
 * @param queryTokens - Tokenized search query
 * @param searchFields - Fields to search with their configurations
 * @param mode - Search mode ('any', 'all', 'phrase')
 * @returns Object containing score (0-1) and matched fields
 */
export function calculateScore<T extends Record<string, unknown>>(
  record: T,
  queryTokens: string[],
  searchFields: Record<string, SearchFieldConfig>,
  mode: SearchMode
): { score: number; matchedFields: string[] } {
  if (queryTokens.length === 0) {
    return { score: 0, matchedFields: [] };
  }

  let totalScore = 0;
  let maxPossibleScore = 0;
  const matchedFields: string[] = [];

  for (const [field, config] of Object.entries(searchFields)) {
    const fieldValue = record[field];
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    const weight = config.weight ?? 1.0;
    maxPossibleScore += weight;

    // Get field content
    let content: string;
    if (config.type === 'array' && Array.isArray(fieldValue)) {
      content = fieldValue.join(' ');
    } else {
      content = String(fieldValue);
    }

    const fieldTokens = tokenize(content, false);
    const contentLower = content.toLowerCase();

    let fieldScore = 0;
    let matchCount = 0;

    if (mode === 'phrase') {
      // For phrase mode, check if the phrase exists in the content
      const phrase = queryTokens[0];
      if (contentLower.includes(phrase)) {
        fieldScore = 1.0;
        matchCount = 1;
      }
    } else {
      // For 'any' or 'all' mode, calculate TF-based score
      for (const queryToken of queryTokens) {
        // Check for exact match or partial match
        const tf = termFrequency(queryToken, fieldTokens);
        if (tf > 0) {
          matchCount++;
          fieldScore += tf;
        } else if (contentLower.includes(queryToken)) {
          // Partial match (substring)
          matchCount++;
          fieldScore += 0.5 / queryTokens.length;
        }
      }

      if (queryTokens.length > 0) {
        fieldScore = fieldScore / queryTokens.length;
      }
    }

    // For 'all' mode, require all tokens to match
    if (mode === 'all' && matchCount < queryTokens.length) {
      fieldScore = 0;
    }

    if (fieldScore > 0) {
      matchedFields.push(field);
      totalScore += fieldScore * weight;
    }
  }

  // Normalize score to 0-1 range
  const normalizedScore = maxPossibleScore > 0 ? Math.min(1, totalScore / maxPossibleScore) : 0;

  return {
    score: normalizedScore,
    matchedFields,
  };
}

// ============================================================================
// Highlighting
// ============================================================================

/**
 * Generates highlighted snippets for matched terms in a field value.
 *
 * @param value - The field value to highlight
 * @param queryTokens - Tokenized search query
 * @param mode - Search mode
 * @param tag - HTML tag to wrap matches (default: 'mark')
 * @param snippetLength - Maximum length of each snippet (default: 150)
 * @returns Array of highlighted snippets
 */
export function generateHighlights(
  value: unknown,
  queryTokens: string[],
  mode: SearchMode,
  tag: string = 'mark',
  snippetLength: number = 150
): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  // Convert to string
  let content: string;
  if (Array.isArray(value)) {
    content = value.join(' ');
  } else {
    content = String(value);
  }

  if (!content || queryTokens.length === 0) {
    return [];
  }

  const highlights: string[] = [];
  const contentLower = content.toLowerCase();

  if (mode === 'phrase') {
    // For phrase mode, find and highlight the phrase
    const phrase = queryTokens[0];
    const index = contentLower.indexOf(phrase);
    if (index !== -1) {
      const snippet = createSnippet(content, index, phrase.length, snippetLength, tag);
      if (snippet) {
        highlights.push(snippet);
      }
    }
  } else {
    // For 'any' or 'all' mode, highlight each matching token
    const matchPositions: Array<{ start: number; length: number }> = [];

    for (const token of queryTokens) {
      let searchIndex = 0;
      while (searchIndex < contentLower.length) {
        const index = contentLower.indexOf(token, searchIndex);
        if (index === -1) break;

        matchPositions.push({ start: index, length: token.length });
        searchIndex = index + 1;
      }
    }

    // Sort positions and merge overlapping ones
    matchPositions.sort((a, b) => a.start - b.start);

    // Create snippets around match positions
    const usedPositions = new Set<number>();
    for (const pos of matchPositions) {
      // Skip if we already have a snippet around this position
      const nearbyUsed = Array.from(usedPositions).some(
        used => Math.abs(used - pos.start) < snippetLength
      );
      if (nearbyUsed) continue;

      const snippet = createSnippet(content, pos.start, pos.length, snippetLength, tag);
      if (snippet) {
        highlights.push(snippet);
        usedPositions.add(pos.start);
      }

      // Limit to 3 snippets per field
      if (highlights.length >= 3) break;
    }
  }

  return highlights;
}

/**
 * Creates a single highlighted snippet around a match position.
 */
function createSnippet(
  content: string,
  matchStart: number,
  matchLength: number,
  snippetLength: number,
  tag: string
): string | null {
  // Calculate snippet boundaries
  const halfSnippet = Math.floor(snippetLength / 2);
  let snippetStart = Math.max(0, matchStart - halfSnippet);
  let snippetEnd = Math.min(content.length, matchStart + matchLength + halfSnippet);

  // Adjust to word boundaries
  if (snippetStart > 0) {
    const spaceIndex = content.indexOf(' ', snippetStart);
    if (spaceIndex !== -1 && spaceIndex < matchStart) {
      snippetStart = spaceIndex + 1;
    }
  }

  if (snippetEnd < content.length) {
    const spaceIndex = content.lastIndexOf(' ', snippetEnd);
    if (spaceIndex !== -1 && spaceIndex > matchStart + matchLength) {
      snippetEnd = spaceIndex;
    }
  }

  // Extract snippet
  let snippet = content.slice(snippetStart, snippetEnd);

  // Add ellipsis if truncated
  if (snippetStart > 0) {
    snippet = '...' + snippet;
  }
  if (snippetEnd < content.length) {
    snippet = snippet + '...';
  }

  // Highlight the match within the snippet
  const highlightedSnippet = highlightTermsInText(
    snippet,
    [content.slice(matchStart, matchStart + matchLength)],
    tag
  );

  return highlightedSnippet;
}

/**
 * Wraps matched terms in highlight tags within text.
 */
function highlightTermsInText(text: string, terms: string[], tag: string): string {
  let result = text;
  const textLower = text.toLowerCase();

  // Sort terms by length (longest first) to handle overlapping matches
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    const termLower = term.toLowerCase();
    let lastIndex = 0;
    let highlighted = '';
    let searchIndex = 0;

    while (searchIndex < textLower.length) {
      const index = textLower.indexOf(termLower, searchIndex);
      if (index === -1) break;

      highlighted += result.slice(lastIndex, index);
      highlighted += `<${tag}>${result.slice(index, index + term.length)}</${tag}>`;
      lastIndex = index + term.length;
      searchIndex = lastIndex;
    }

    if (highlighted) {
      highlighted += result.slice(lastIndex);
      result = highlighted;
    }
  }

  return result;
}

// ============================================================================
// Search Field Parsing
// ============================================================================

/**
 * Parses search fields from query parameter or configuration.
 *
 * @param fieldsParam - Comma-separated field names from query
 * @param configuredFields - Fields configured on the endpoint
 * @returns Array of field names to search
 */
export function parseSearchFields(
  fieldsParam: string | undefined,
  configuredFields: Record<string, SearchFieldConfig>
): string[] {
  if (!fieldsParam) {
    return Object.keys(configuredFields);
  }

  const requested = fieldsParam.split(',').map(f => f.trim()).filter(Boolean);
  const available = Object.keys(configuredFields);

  // Filter to only configured fields
  return requested.filter(f => available.includes(f));
}

/**
 * Builds a search configuration object from field arrays.
 *
 * @param fields - Array of field names
 * @param weights - Optional weight mapping
 * @returns Search field configuration
 */
export function buildSearchConfig(
  fields: string[],
  weights?: Record<string, number>
): Record<string, SearchFieldConfig> {
  const config: Record<string, SearchFieldConfig> = {};

  for (const field of fields) {
    config[field] = {
      weight: weights?.[field] ?? 1.0,
    };
  }

  return config;
}
