let _pluralize: typeof import('pluralize') | undefined;
let _distance: typeof import('fastest-levenshtein').distance | undefined;

async function loadPluralize() {
  if (!_pluralize) {
    try {
      _pluralize = (await import('pluralize')).default;
    } catch {
      throw new Error(
        'The "pluralize" package is required by the Prisma adapter. ' +
        'Install it with: npm install pluralize'
      );
    }
  }
  return _pluralize;
}

async function loadDistance() {
  if (!_distance) {
    try {
      _distance = (await import('fastest-levenshtein')).distance;
    } catch {
      throw new Error(
        'The "fastest-levenshtein" package is required by the Prisma adapter. ' +
        'Install it with: npm install fastest-levenshtein'
      );
    }
  }
  return _distance;
}

export async function inlineSingular(word: string): Promise<string> {
  const pluralize = await loadPluralize();
  return pluralize.singular(word);
}

export async function levenshteinDistance(a: string, b: string): Promise<number> {
  const distance = await loadDistance();
  return distance(a, b);
}
