/**
 * Interface for encryption key providers.
 * Implement this to integrate with your key management system.
 */
export interface EncryptionKeyProvider {
  /** Get the current encryption key (raw bytes). */
  getKey(): Promise<ArrayBuffer>;
  /** Get a key by ID (for key rotation support). */
  getKeyById?(keyId: string): Promise<ArrayBuffer>;
  /** Get the current key ID. */
  getCurrentKeyId?(): string;
}

/**
 * Configuration for field-level encryption.
 */
export interface FieldEncryptionConfig {
  /** Fields to encrypt. */
  fields: string[];
  /** Key provider for encryption keys. */
  keyProvider: EncryptionKeyProvider;
  /** Algorithm to use. @default 'AES-GCM' */
  algorithm?: 'AES-GCM';
  /** Whether to encode encrypted values as base64. @default true */
  base64Encode?: boolean;
}

/**
 * Encrypted field value with metadata for decryption.
 */
export interface EncryptedValue {
  /** Encrypted data (base64) */
  ct: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Key ID used for encryption */
  kid?: string;
  /** Encryption version marker */
  v: 1;
}
