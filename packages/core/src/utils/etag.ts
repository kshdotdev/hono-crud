/**
 * ETag generation and conditional-request utilities (Web Crypto only,
 * edge-safe on Cloudflare Workers / Deno / Bun).
 *
 * Input data is canonicalized (object keys sorted recursively) before
 * hashing, so two records with the same content but different key order
 * produce the same ETag.
 */

/**
 * Recursively canonicalize a value for deterministic JSON serialization.
 * Arrays are preserved in order; objects have their keys sorted.
 * Cycles are not handled — callers must avoid them.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export async function generateETag(data: unknown): Promise<string> {
  const json = JSON.stringify(canonicalize(data));
  const buffer = new TextEncoder().encode(json);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(hash));
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `"${hex.substring(0, 32)}"`;
}

export function matchesIfNoneMatch(
  ifNoneMatch: string | null | undefined,
  etag: string
): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch === '*') return true;
  return ifNoneMatch.split(',').map((t) => t.trim()).includes(etag);
}

export function matchesIfMatch(
  ifMatch: string | null | undefined,
  etag: string
): boolean {
  if (!ifMatch) return true;
  if (ifMatch === '*') return true;
  return ifMatch.split(',').map((t) => t.trim()).includes(etag);
}
