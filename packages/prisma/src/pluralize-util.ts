/**
 * Lazy-loaded `pluralize` and `fastest-levenshtein` accessors.
 * Optional peer-dependencies; only loaded when first called.
 *
 * Used by the Prisma adapter today; intended to be reusable when other
 * adapters need name normalization.
 */

let _pluralize: typeof import('pluralize') | undefined;
let _distance: typeof import('fastest-levenshtein').distance | undefined;

async function loadPluralize() {
  if (_pluralize) return _pluralize;
  try {
    _pluralize = (await import('pluralize')).default;
    return _pluralize;
  } catch {
    throw new Error(
      'The "pluralize" package is required. Install it with: npm install pluralize'
    );
  }
}

async function loadDistance() {
  if (_distance) return _distance;
  try {
    _distance = (await import('fastest-levenshtein')).distance;
    return _distance;
  } catch {
    throw new Error(
      'The "fastest-levenshtein" package is required. Install it with: npm install fastest-levenshtein'
    );
  }
}

export async function inlineSingular(word: string): Promise<string> {
  const p = await loadPluralize();
  return p.singular(word);
}

export async function inlinePlural(word: string): Promise<string> {
  const p = await loadPluralize();
  return p.plural(word);
}

export async function levenshteinDistance(a: string, b: string): Promise<number> {
  const distance = await loadDistance();
  return distance(a, b);
}
