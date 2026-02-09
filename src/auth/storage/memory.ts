import type { APIKeyEntry, APIKeyLookupResult } from '../types';
import { createRegistryWithDefault } from '../../storage/registry';

// ============================================================================
// In-Memory API Key Storage
// ============================================================================

/**
 * In-memory storage for API keys.
 * Useful for testing and development.
 *
 * @example
 * ```ts
 * const storage = new MemoryAPIKeyStorage();
 *
 * // Generate and store a key
 * const { key, entry } = await storage.generateKey({
 *   userId: 'user-123',
 *   roles: ['api-user'],
 * });
 *
 * console.log('Your API key:', key);
 *
 * // Use with middleware
 * app.use('*', createAPIKeyMiddleware({
 *   lookupKey: (hash) => storage.lookup(hash),
 * }));
 * ```
 */
export class MemoryAPIKeyStorage {
  private keys: Map<string, APIKeyEntry> = new Map();
  private hashToId: Map<string, string> = new Map();

  /**
   * Stores an API key entry.
   */
  async store(entry: APIKeyEntry): Promise<void> {
    this.keys.set(entry.id, entry);
    this.hashToId.set(entry.keyHash, entry.id);
  }

  /**
   * Looks up an API key by its hash.
   */
  async lookup(keyHash: string): Promise<APIKeyLookupResult> {
    const id = this.hashToId.get(keyHash);
    if (!id) {
      return null;
    }
    return this.keys.get(id) || null;
  }

  /**
   * Looks up an API key by its ID.
   */
  async getById(id: string): Promise<APIKeyLookupResult> {
    return this.keys.get(id) || null;
  }

  /**
   * Gets all API keys for a user.
   */
  async getByUserId(userId: string): Promise<APIKeyEntry[]> {
    const userKeys: APIKeyEntry[] = [];
    for (const entry of this.keys.values()) {
      if (entry.userId === userId) {
        userKeys.push(entry);
      }
    }
    return userKeys;
  }

  /**
   * Revokes an API key by its ID.
   */
  async revoke(id: string): Promise<boolean> {
    const entry = this.keys.get(id);
    if (!entry) {
      return false;
    }

    // Mark as inactive
    entry.active = false;
    return true;
  }

  /**
   * Deletes an API key permanently.
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.keys.get(id);
    if (!entry) {
      return false;
    }

    this.hashToId.delete(entry.keyHash);
    this.keys.delete(id);
    return true;
  }

  /**
   * Updates the last used timestamp for a key.
   */
  async updateLastUsed(id: string): Promise<void> {
    const entry = this.keys.get(id);
    if (entry) {
      entry.lastUsedAt = new Date();
    }
  }

  /**
   * Generates a new API key and stores it.
   *
   * @param options - Options for the new key
   * @returns The raw API key (show to user once) and the stored entry
   */
  async generateKey(options: {
    userId: string;
    name?: string;
    roles?: string[];
    permissions?: string[];
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
    prefix?: string;
  }): Promise<{ key: string; entry: APIKeyEntry }> {
    const prefix = options.prefix || 'sk';
    const key = generateAPIKey(prefix);
    const keyHash = await hashAPIKey(key);

    const entry: APIKeyEntry = {
      id: crypto.randomUUID(),
      keyHash,
      userId: options.userId,
      name: options.name,
      roles: options.roles,
      permissions: options.permissions,
      expiresAt: options.expiresAt ?? null,
      active: true,
      createdAt: new Date(),
      metadata: options.metadata,
    };

    await this.store(entry);

    return { key, entry };
  }

  /**
   * Gets all stored keys (for testing).
   */
  getAllKeys(): APIKeyEntry[] {
    return Array.from(this.keys.values());
  }

  /**
   * Clears all stored keys (for testing).
   */
  clear(): void {
    this.keys.clear();
    this.hashToId.clear();
  }
}

// ============================================================================
// API Key Generation Utilities
// ============================================================================

/**
 * Generates a random API key.
 *
 * @param prefix - Prefix for the key (e.g., 'sk' for secret key)
 * @param length - Length of the random portion (default: 32)
 * @returns A formatted API key like "sk_a1b2c3d4..."
 *
 * @example
 * ```ts
 * const key = generateAPIKey('sk');
 * // Returns: "sk_a1b2c3d4e5f6g7h8i9j0..."
 * ```
 */
export function generateAPIKey(prefix: string = 'sk', length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }

  return `${prefix}_${result}`;
}

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

/**
 * Validates the format of an API key.
 *
 * @param key - The API key to validate
 * @param prefix - Expected prefix (optional)
 * @returns True if the key has a valid format
 */
export function isValidAPIKeyFormat(key: string, prefix?: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  // Check for prefix_random format
  const parts = key.split('_');
  if (parts.length !== 2) {
    return false;
  }

  const [keyPrefix, random] = parts;

  // Check prefix if specified
  if (prefix && keyPrefix !== prefix) {
    return false;
  }

  // Random part should be alphanumeric and at least 16 chars
  if (!/^[A-Za-z0-9]{16,}$/.test(random)) {
    return false;
  }

  return true;
}

// ============================================================================
// Global Storage Instance
// ============================================================================

/**
 * Global API key storage registry.
 * Uses lazy initialization -- the default MemoryAPIKeyStorage is only
 * created when first accessed.
 */
export const apiKeyStorageRegistry = createRegistryWithDefault<MemoryAPIKeyStorage>(
  'apiKeyStorage',
  () => new MemoryAPIKeyStorage()
);

/**
 * Gets the global API key storage.
 */
export function getAPIKeyStorage(): MemoryAPIKeyStorage {
  return apiKeyStorageRegistry.getRequired();
}

/**
 * Sets the global API key storage.
 */
export function setAPIKeyStorage(storage: MemoryAPIKeyStorage): void {
  apiKeyStorageRegistry.set(storage);
}
