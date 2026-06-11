// ============================================================================
// API Key Hashing
// ============================================================================

/**
 * Hashes an API key using SHA-256.
 * Never store raw API keys - always store the hash.
 *
 * @param key - The raw API key
 * @returns The SHA-256 hash as a hex string
 *
 * @example
 * ```ts
 * const hash = await hashAPIKey('sk_abc123...');
 * // Store `hash` in your database
 * ```
 */
export async function hashAPIKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
