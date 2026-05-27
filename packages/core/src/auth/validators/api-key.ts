import type { APIKeyEntry } from '../types';
import { UnauthorizedException } from '../../core/exceptions';

/**
 * Validates an API key entry (after lookup).
 * Checks if the key is active and not expired.
 * This is extracted as a shared validator to eliminate duplication between
 * createAPIKeyMiddleware and validateAPIKey functions.
 *
 * @param entry - The API key entry from lookup (or null if not found)
 * @throws UnauthorizedException if validation fails
 * @returns The validated entry
 *
 * @example
 * ```ts
 * const entry = await lookupKey(keyHash);
 * const validEntry = validateAPIKeyEntry(entry);
 * // Use validEntry...
 * ```
 */
export function validateAPIKeyEntry(entry: APIKeyEntry | null): APIKeyEntry {
  if (!entry) {
    throw new UnauthorizedException('Invalid API key');
  }

  // Check if active
  if (!entry.active) {
    throw new UnauthorizedException('API key has been revoked');
  }

  // Check if expired
  if (entry.expiresAt && new Date() > entry.expiresAt) {
    throw new UnauthorizedException('API key has expired');
  }

  return entry;
}
