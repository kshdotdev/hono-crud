import { z } from 'zod';

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
 * Schema for an encrypted field value with metadata for decryption. Single
 * source of truth: {@link EncryptedValue} is inferred from it and the runtime
 * guard `isEncryptedValue` validates against it, so the type and the check
 * cannot drift.
 */
export const encryptedValueSchema = z.object({
  /** Encrypted data (base64) */
  ct: z.string(),
  /** Initialization vector (base64) */
  iv: z.string(),
  /** Key ID used for encryption */
  kid: z.string().optional(),
  /** Encryption version marker */
  v: z.literal(1),
});

/**
 * Encrypted field value with metadata for decryption.
 */
export type EncryptedValue = z.infer<typeof encryptedValueSchema>;
