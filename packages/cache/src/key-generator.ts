import type { CacheKeyOptions, InvalidationPatternOptions } from './types';

/**
 * Generates a cache key from the given options.
 *
 * Key format: `{prefix}:{tableName}:{method}:{pathParams}:{queryParams}:{userId?}`
 *
 * @example
 * generateCacheKey({
 *   tableName: 'users',
 *   method: 'GET',
 *   params: { id: '123' },
 * }) // => 'users:GET:id=123'
 *
 * @example
 * generateCacheKey({
 *   tableName: 'users',
 *   method: 'LIST',
 *   query: { page: 1, per_page: 20, status: 'active' },
 *   keyFields: ['page', 'per_page', 'status'],
 * }) // => 'users:LIST:page=1&per_page=20&status=active'
 *
 * @example
 * generateCacheKey({
 *   tableName: 'users',
 *   method: 'GET',
 *   params: { id: '123' },
 *   userId: '456',
 * }) // => 'users:GET:id=123:user=456'
 */
export function generateCacheKey(options: CacheKeyOptions): string {
  const { tableName, method, params, query, keyFields, userId, prefix } = options;

  const parts: string[] = [];

  // Add prefix if provided
  if (prefix) {
    parts.push(prefix);
  }

  // Add table name and method
  parts.push(tableName);
  parts.push(method);

  // Add sorted path parameters
  if (params && Object.keys(params).length > 0) {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    parts.push(sortedParams);
  }

  // Add sorted query parameters (only those in keyFields if specified)
  if (query && Object.keys(query).length > 0) {
    let queryKeys = Object.keys(query).filter(
      (key) => query[key] !== undefined && query[key] !== null && query[key] !== ''
    );

    // Filter to keyFields if specified
    if (keyFields && keyFields.length > 0) {
      queryKeys = queryKeys.filter((key) => keyFields.includes(key));
    }

    if (queryKeys.length > 0) {
      const sortedQuery = queryKeys
        .sort()
        .map((key) => `${key}=${String(query[key])}`)
        .join('&');
      parts.push(sortedQuery);
    }
  }

  // Add user ID for per-user caching
  if (userId) {
    parts.push(`user=${userId}`);
  }

  return parts.join(':');
}

/**
 * Creates an invalidation pattern for cache entries.
 *
 * @example
 * createInvalidationPattern('users')
 * // => 'users:*'
 *
 * @example
 * createInvalidationPattern('users', { method: 'LIST' })
 * // => 'users:LIST*'
 *
 * @example
 * createInvalidationPattern('users', { id: '123' })
 * // => 'users:*:id=123*'
 *
 * @example
 * createInvalidationPattern('users', { userId: '456' })
 * // => 'users:*:user=456'
 */
export function createInvalidationPattern(
  tableName: string,
  options?: InvalidationPatternOptions,
  prefix?: string
): string {
  const parts: string[] = [];

  // Add prefix if provided
  if (prefix) {
    parts.push(prefix);
  }

  // Add table name
  parts.push(tableName);

  if (!options) {
    // Invalidate all caches for this table
    parts.push('*');
    return parts.join(':');
  }

  const { method, id, userId } = options;

  if (method) {
    parts.push(method);
    // Use * to match both "users:LIST" and "users:LIST:something"
    return parts.join(':') + '*';
  } else if (id !== undefined) {
    // Invalidate specific record across all methods
    parts.push('*');
    parts.push(`id=${id}*`);
  } else if (userId) {
    // Invalidate all user-specific caches
    parts.push('*');
    parts.push(`user=${userId}`);
  } else {
    parts.push('*');
  }

  return parts.join(':');
}

/**
 * Creates patterns for invalidating related caches.
 *
 * @example
 * createRelatedPatterns('users', ['posts', 'comments'])
 * // => ['posts:*', 'comments:*']
 */
export function createRelatedPatterns(
  _tableName: string,
  relatedModels: string[],
  prefix?: string
): string[] {
  return relatedModels.map((model) => createInvalidationPattern(model, undefined, prefix));
}

/**
 * Checks if a cache key matches a glob-style pattern.
 *
 * Supports:
 * - `*` - matches any characters
 * - Exact matching for non-wildcard patterns
 *
 * @example
 * matchesPattern('users:GET:id=123', 'users:*') // => true
 * matchesPattern('users:GET:id=123', 'users:LIST:*') // => false
 * matchesPattern('users:GET:id=123', 'users:GET:id=123') // => true
 */
export function matchesPattern(key: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
    .replace(/\*/g, '.*'); // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(key);
}

/**
 * Parses a cache key back into its components.
 *
 * @example
 * parseCacheKey('users:GET:id=123')
 * // => { tableName: 'users', method: 'GET', params: { id: '123' } }
 *
 * @example
 * parseCacheKey('myprefix:users:LIST:page=1&per_page=20:user=456')
 * // => { prefix: 'myprefix', tableName: 'users', method: 'LIST', query: { page: '1', per_page: '20' }, userId: '456' }
 */
export function parseCacheKey(key: string): {
  prefix?: string;
  tableName: string;
  method: 'GET' | 'LIST';
  params?: Record<string, string>;
  query?: Record<string, string>;
  userId?: string;
} {
  const parts = key.split(':');

  // Detect if there's a prefix (check if second part is a known method)
  const hasPrefix = parts.length > 2 && !['GET', 'LIST'].includes(parts[1]);

  let idx = 0;
  const prefix = hasPrefix ? parts[idx++] : undefined;
  const tableName = parts[idx++];
  const method = parts[idx++] as 'GET' | 'LIST';

  const result: {
    prefix?: string;
    tableName: string;
    method: 'GET' | 'LIST';
    params?: Record<string, string>;
    query?: Record<string, string>;
    userId?: string;
  } = { tableName, method };

  if (prefix) {
    result.prefix = prefix;
  }

  // Parse remaining parts
  for (let i = idx; i < parts.length; i++) {
    const part = parts[i];

    if (part.startsWith('user=')) {
      result.userId = part.substring(5);
    } else if (part.includes('=')) {
      // Parse key=value pairs
      const pairs = part.split('&');
      const parsed: Record<string, string> = {};

      for (const pair of pairs) {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) {
          parsed[k] = v;
        }
      }

      // Determine if these are params or query based on method
      if (method === 'GET' && !result.params) {
        result.params = parsed;
      } else if (method === 'LIST' && !result.query) {
        result.query = parsed;
      } else if (!result.params) {
        result.params = parsed;
      } else {
        result.query = parsed;
      }
    }
  }

  return result;
}
