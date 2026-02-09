import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  applyProfile,
  applyProfileToArray,
  resolveProfile,
  createSerializer,
  createArraySerializer,
} from '../src/serialization/index';
import type { SerializationProfile, SerializationConfig } from '../src/serialization/index';
import {
  encryptValue,
  decryptValue,
  isEncryptedValue,
  encryptFields,
  decryptFields,
  StaticKeyProvider,
} from '../src/encryption/index';
import type { EncryptedValue } from '../src/encryption/index';
import { fromHono } from '../src/core/openapi';
import { defineModel, defineMeta } from '../src/core/types';
import { MemoryBulkPatchEndpoint } from '../src/adapters/memory/index';

// ============================================================================
// Serialization Profiles
// ============================================================================

describe('Serialization Profiles', () => {
  const record = {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    password: 'hashed_secret',
    role: 'admin',
    createdAt: '2024-01-01',
  };

  describe('applyProfile', () => {
    it('should include only specified fields', () => {
      const profile: SerializationProfile = {
        name: 'public',
        include: ['id', 'name'],
      };
      const result = applyProfile(record, profile);
      expect(result).toEqual({ id: '1', name: 'John Doe' });
    });

    it('should exclude specified fields', () => {
      const profile: SerializationProfile = {
        name: 'safe',
        exclude: ['password'],
      };
      const result = applyProfile(record, profile);
      expect(result.password).toBeUndefined();
      expect(result.name).toBe('John Doe');
    });

    it('should apply alwaysInclude even when not in include list', () => {
      const profile: SerializationProfile = {
        name: 'minimal',
        include: ['name'],
        alwaysInclude: ['id'],
      };
      const result = applyProfile(record, profile);
      expect(result.id).toBe('1');
      expect(result.name).toBe('John Doe');
    });

    it('should apply custom transform', () => {
      const profile: SerializationProfile = {
        name: 'transformed',
        include: ['id', 'name', 'email'],
        transform: (data) => ({
          ...data,
          displayName: `User: ${data.name}`,
        }),
      };
      const result = applyProfile(record, profile);
      expect(result.displayName).toBe('User: John Doe');
    });

    it('should return all fields when no include/exclude', () => {
      const profile: SerializationProfile = { name: 'full' };
      const result = applyProfile(record, profile);
      expect(Object.keys(result).length).toBe(Object.keys(record).length);
    });
  });

  describe('applyProfileToArray', () => {
    it('should apply profile to all records', () => {
      const profile: SerializationProfile = {
        name: 'public',
        include: ['id', 'name'],
      };
      const records = [record, { ...record, id: '2', name: 'Jane' }];
      const result = applyProfileToArray(records, profile);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: '1', name: 'John Doe' });
      expect(result[1]).toEqual({ id: '2', name: 'Jane' });
    });
  });

  describe('resolveProfile', () => {
    const config: SerializationConfig = {
      profiles: [
        { name: 'public', include: ['id', 'name'] },
        { name: 'admin', exclude: ['password'] },
      ],
      defaultProfile: 'public',
    };

    it('should resolve by name', () => {
      const profile = resolveProfile(config, 'admin');
      expect(profile?.name).toBe('admin');
    });

    it('should use default when no name provided', () => {
      const profile = resolveProfile(config);
      expect(profile?.name).toBe('public');
    });

    it('should return undefined for unknown profile', () => {
      const profile = resolveProfile(config, 'unknown');
      expect(profile).toBeUndefined();
    });
  });

  describe('createSerializer', () => {
    it('should create a reusable serializer', () => {
      const config: SerializationConfig = {
        profiles: [
          { name: 'public', include: ['id', 'name'] },
        ],
      };
      const serialize = createSerializer(config);
      const result = serialize(record, 'public');
      expect(result).toEqual({ id: '1', name: 'John Doe' });
    });

    it('should return unmodified record when profile not found', () => {
      const config: SerializationConfig = { profiles: [] };
      const serialize = createSerializer(config);
      const result = serialize(record, 'missing');
      expect(result).toEqual(record);
    });
  });

  describe('createArraySerializer', () => {
    it('should create a reusable array serializer', () => {
      const config: SerializationConfig = {
        profiles: [
          { name: 'public', include: ['id'] },
        ],
      };
      const serialize = createArraySerializer(config);
      const result = serialize([record], 'public');
      expect(result).toEqual([{ id: '1' }]);
    });
  });
});

// ============================================================================
// Field-Level Encryption
// ============================================================================

describe('Field-Level Encryption', () => {
  let keyProvider: StaticKeyProvider;

  beforeEach(async () => {
    const keyBase64 = await StaticKeyProvider.generateKey();
    keyProvider = new StaticKeyProvider(keyBase64, 'test-key');
  });

  describe('encryptValue / decryptValue', () => {
    it('should encrypt and decrypt a string', async () => {
      const original = 'Hello, World!';
      const encrypted = await encryptValue(original, keyProvider);

      expect(encrypted.v).toBe(1);
      expect(encrypted.ct).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.kid).toBe('test-key');

      const decrypted = await decryptValue(encrypted, keyProvider);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertexts for same plaintext', async () => {
      const original = 'same value';
      const enc1 = await encryptValue(original, keyProvider);
      const enc2 = await encryptValue(original, keyProvider);

      // Different IVs should produce different ciphertexts
      expect(enc1.ct).not.toBe(enc2.ct);

      // Both should decrypt to same value
      expect(await decryptValue(enc1, keyProvider)).toBe(original);
      expect(await decryptValue(enc2, keyProvider)).toBe(original);
    });
  });

  describe('isEncryptedValue', () => {
    it('should identify encrypted values', async () => {
      const encrypted = await encryptValue('test', keyProvider);
      expect(isEncryptedValue(encrypted)).toBe(true);
    });

    it('should reject non-encrypted values', () => {
      expect(isEncryptedValue('plain string')).toBe(false);
      expect(isEncryptedValue(null)).toBe(false);
      expect(isEncryptedValue({ ct: 'x' })).toBe(false);
      expect(isEncryptedValue({ ct: 'x', iv: 'y', v: 2 })).toBe(false);
    });
  });

  describe('encryptFields / decryptFields', () => {
    it('should encrypt and decrypt specified fields', async () => {
      const record = {
        id: '1',
        name: 'John',
        ssn: '123-45-6789',
        email: 'john@example.com',
      };

      const encrypted = await encryptFields(record, ['ssn', 'email'], keyProvider);

      // Unencrypted fields should remain
      expect(encrypted.id).toBe('1');
      expect(encrypted.name).toBe('John');

      // Encrypted fields should be EncryptedValue objects
      expect(isEncryptedValue(encrypted.ssn)).toBe(true);
      expect(isEncryptedValue(encrypted.email)).toBe(true);

      // Decrypt and verify
      const decrypted = await decryptFields(encrypted, ['ssn', 'email'], keyProvider);
      expect(decrypted.ssn).toBe('123-45-6789');
      expect(decrypted.email).toBe('john@example.com');
    });

    it('should skip null/undefined fields', async () => {
      const record = { id: '1', ssn: null, email: undefined };
      const encrypted = await encryptFields(
        record as Record<string, unknown>,
        ['ssn', 'email'],
        keyProvider
      );
      expect(encrypted.ssn).toBeNull();
      expect(encrypted.email).toBeUndefined();
    });

    it('should skip non-encrypted fields during decrypt', async () => {
      const record = { id: '1', ssn: 'plain text' };
      const decrypted = await decryptFields(record, ['ssn'], keyProvider);
      expect(decrypted.ssn).toBe('plain text'); // Not encrypted, left as-is
    });
  });

  describe('StaticKeyProvider', () => {
    it('should generate a key', async () => {
      const key = await StaticKeyProvider.generateKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('should throw for unknown key ID', async () => {
      await expect(
        keyProvider.getKeyById('unknown')
      ).rejects.toThrow('Unknown key ID');
    });
  });
});

// ============================================================================
// Bulk Patch with Filters
// ============================================================================

describe('Bulk Patch Endpoint', () => {
  const UserModel = defineModel({
    tableName: 'bulk_users',
    schema: z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      active: z.boolean(),
    }),
    primaryKeys: ['id'],
  });

  const UserMeta = defineMeta({
    model: UserModel,
  });

  class UserBulkPatch extends MemoryBulkPatchEndpoint {
    _meta = UserMeta;
    protected filterFields = ['role', 'active'];
    protected confirmThreshold = 3;
    protected returnRecords = true;

    getModelSchema() {
      return UserModel.schema;
    }

    getUpdateSchema() {
      return z.object({
        name: z.string(),
        role: z.string(),
        active: z.boolean(),
      });
    }
  }

  let app: ReturnType<typeof fromHono>;

  beforeEach(() => {
    // Clear the memory store
    const store = new Map();

    app = fromHono(new Hono());

    // Seed test data
    const seedApp = new Hono();
    seedApp.post('/seed', async (c) => {
      const body = await c.req.json();
      // Access the internal store directly
      const memStore = (globalThis as Record<string, unknown>).__test_store as Map<string, unknown> | undefined;
      if (memStore) {
        for (const item of body) {
          memStore.set(item.id, item);
        }
      }
      return c.json({ ok: true });
    });

    app.patch('/bulk_users/bulk', UserBulkPatch);
  });

  it('should be defined', () => {
    expect(UserBulkPatch).toBeDefined();
  });

  it('should have correct abstract methods', () => {
    const instance = new UserBulkPatch();
    expect(typeof instance.getModelSchema).toBe('function');
    expect(typeof instance.getUpdateSchema).toBe('function');
  });
});
