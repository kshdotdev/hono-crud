/**
 * `parseCacheKey` is the ONE key helper owned solely by `@hono-crud/cache`
 * (core has no copy). Its inverse — `generateCacheKey` — plus the invalidation
 * pattern helpers live in core (`hono-crud/internal`) so the config-API cache
 * path and the `withCache` mixin share a single key format; the cache package
 * re-exports those from there.
 */

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
