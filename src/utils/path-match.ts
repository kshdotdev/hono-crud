/**
 * Path matching shared by auth/, rate-limit/, logging/, cache/.
 *
 * Glob semantics:
 *   `*`   matches a single path segment (no `/`)
 *   `**`  matches any number of segments (including `/`)
 *   regex patterns are tested directly
 *
 * Uses NUL placeholders so that regex-escaping does not collide with the
 * wildcard expansion (the rate-limit/auth versions had a fragile escape order).
 */

export type PathPattern = string | RegExp;

const DOUBLE_STAR = '\0DOUBLE_STAR\0';
const SINGLE_STAR = '\0SINGLE_STAR\0';

export function matchPath(path: string, pattern: PathPattern): boolean {
  if (pattern instanceof RegExp) return pattern.test(path);
  if (!pattern.includes('*')) return path === pattern;

  const regex = pattern
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(new RegExp(DOUBLE_STAR, 'g'), '.*')
    .replace(new RegExp(SINGLE_STAR, 'g'), '[^/]*');

  return new RegExp(`^${regex}$`).test(path);
}

/** Returns true if `path` matches any pattern in the list. */
export function matchAny(path: string, patterns: PathPattern[]): boolean {
  for (const p of patterns) {
    if (matchPath(path, p)) return true;
  }
  return false;
}

/**
 * Include/exclude evaluation. Excludes always win.
 * If `includes` is empty, all paths are included unless excluded.
 */
export function isPathIncluded(
  path: string,
  includes: PathPattern[],
  excludes: PathPattern[]
): boolean {
  if (matchAny(path, excludes)) return false;
  if (includes.length === 0) return true;
  return matchAny(path, includes);
}
