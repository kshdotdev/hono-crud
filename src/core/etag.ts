/**
 * ETag generation and conditional request utilities.
 * Uses Web Crypto API (edge-safe: works on Cloudflare Workers, Deno, Bun).
 */

/**
 * Generate an ETag from record data using Web Crypto API.
 * Uses SHA-256 hash of the JSON-serialized data, truncated to 32 hex chars.
 *
 * @example
 * ```ts
 * const etag = await generateETag({ id: 1, name: 'John' });
 * // => '"a1b2c3d4e5f6..."'
 * ```
 */
export async function generateETag(data: unknown): Promise<string> {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `"${hashHex.substring(0, 32)}"`;
}

/**
 * Check if a request's If-None-Match header matches the given ETag.
 * Used for GET requests to return 304 Not Modified.
 *
 * @returns true if the ETag matches (client has fresh copy)
 */
export function matchesIfNoneMatch(
  ifNoneMatch: string | null | undefined,
  etag: string
): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch === '*') return true;
  const tags = ifNoneMatch.split(',').map((t) => t.trim());
  return tags.includes(etag);
}

/**
 * Check if a request's If-Match header matches the given ETag.
 * Used for PUT/PATCH requests to prevent lost updates (optimistic concurrency).
 *
 * @returns true if the ETag matches (OK to proceed with update)
 */
export function matchesIfMatch(
  ifMatch: string | null | undefined,
  etag: string
): boolean {
  if (!ifMatch) return true; // No If-Match header means proceed
  if (ifMatch === '*') return true;
  const tags = ifMatch.split(',').map((t) => t.trim());
  return tags.includes(etag);
}
