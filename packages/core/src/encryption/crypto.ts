import type { EncryptedValue, EncryptionKeyProvider } from './types';

/**
 * Convert ArrayBuffer to base64 string.
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Import a raw key for AES-GCM.
 */
async function importKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a string value using AES-GCM.
 * Uses Web Crypto API (edge-safe).
 */
export async function encryptValue(
  value: string,
  keyProvider: EncryptionKeyProvider
): Promise<EncryptedValue> {
  const rawKey = await keyProvider.getKey();
  const cryptoKey = await importKey(rawKey);

  // Generate random IV (96 bits for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(value);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintext
  );

  const result: EncryptedValue = {
    ct: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv.buffer),
    v: 1,
  };

  if (keyProvider.getCurrentKeyId) {
    result.kid = keyProvider.getCurrentKeyId();
  }

  return result;
}

/**
 * Decrypt an encrypted value using AES-GCM.
 */
export async function decryptValue(
  encrypted: EncryptedValue,
  keyProvider: EncryptionKeyProvider
): Promise<string> {
  let rawKey: ArrayBuffer;

  if (encrypted.kid && keyProvider.getKeyById) {
    rawKey = await keyProvider.getKeyById(encrypted.kid);
  } else {
    rawKey = await keyProvider.getKey();
  }

  const cryptoKey = await importKey(rawKey);
  const iv = base64ToBuffer(encrypted.iv);
  const ciphertext = base64ToBuffer(encrypted.ct);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    cryptoKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Check if a value looks like an encrypted value object.
 */
export function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ct === 'string' &&
    typeof obj.iv === 'string' &&
    obj.v === 1
  );
}

/**
 * Encrypt specified fields in a record.
 */
export async function encryptFields(
  record: Record<string, unknown>,
  fields: string[],
  keyProvider: EncryptionKeyProvider
): Promise<Record<string, unknown>> {
  const result = { ...record };

  for (const field of fields) {
    if (field in result && result[field] != null) {
      const value = String(result[field]);
      result[field] = await encryptValue(value, keyProvider);
    }
  }

  return result;
}

/**
 * Decrypt specified fields in a record.
 */
export async function decryptFields(
  record: Record<string, unknown>,
  fields: string[],
  keyProvider: EncryptionKeyProvider
): Promise<Record<string, unknown>> {
  const result = { ...record };

  for (const field of fields) {
    if (field in result && isEncryptedValue(result[field])) {
      result[field] = await decryptValue(
        result[field] as EncryptedValue,
        keyProvider
      );
    }
  }

  return result;
}

/**
 * Simple static key provider for development/testing.
 * In production, use a proper key management service.
 */
export class StaticKeyProvider implements EncryptionKeyProvider {
  private key: ArrayBuffer;
  private keyId: string;

  constructor(keyBase64: string, keyId: string = 'default') {
    this.key = base64ToBuffer(keyBase64);
    this.keyId = keyId;
  }

  async getKey(): Promise<ArrayBuffer> {
    return this.key;
  }

  async getKeyById(keyId: string): Promise<ArrayBuffer> {
    if (keyId !== this.keyId) {
      throw new Error(`Unknown key ID: ${keyId}`);
    }
    return this.key;
  }

  getCurrentKeyId(): string {
    return this.keyId;
  }

  /**
   * Generate a random 256-bit key and return as base64.
   */
  static async generateKey(): Promise<string> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return bufferToBase64(key.buffer);
  }
}
