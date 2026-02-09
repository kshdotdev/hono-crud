import pluralize from 'pluralize';
import { distance } from 'fastest-levenshtein';

export function inlineSingular(word: string): string {
  return pluralize.singular(word);
}

export function levenshteinDistance(a: string, b: string): number {
  return distance(a, b);
}
