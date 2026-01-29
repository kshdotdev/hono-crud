/**
 * Tests for Computed Fields functionality.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineModel,
  defineMeta,
  type ComputedFieldsConfig,
  applyComputedFields,
  applyComputedFieldsToArray,
} from '../src/index.js';

// ============================================================================
// Test Data
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string(),
  status: z.enum(['active', 'inactive', 'pending']),
  emailVerified: z.boolean(),
});

type User = z.infer<typeof UserSchema>;

const userComputedFields: ComputedFieldsConfig<User> = {
  fullName: {
    compute: (user) => `${user.firstName} ${user.lastName}`,
    schema: z.string(),
    dependsOn: ['firstName', 'lastName'],
  },
  age: {
    compute: (user) => {
      const birth = new Date(user.birthDate);
      const today = new Date('2026-01-27'); // Fixed date for testing
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    },
    schema: z.number(),
  },
  isFullyActive: {
    compute: (user) => user.status === 'active' && user.emailVerified,
    schema: z.boolean(),
  },
  asyncGreeting: {
    compute: async (user) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `Hello, ${user.firstName}!`;
    },
    schema: z.string(),
  },
};

const testUser: User = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  firstName: 'John',
  lastName: 'Doe',
  birthDate: '1990-05-15',
  status: 'active',
  emailVerified: true,
};

// ============================================================================
// Tests
// ============================================================================

describe('Computed Fields', () => {
  describe('applyComputedFields', () => {
    it('should compute all fields for a single record', async () => {
      const result = await applyComputedFields(testUser, userComputedFields);

      expect(result.fullName).toBe('John Doe');
      expect(result.age).toBe(35);
      expect(result.isFullyActive).toBe(true);
      expect(result.asyncGreeting).toBe('Hello, John!');
    });

    it('should preserve original fields', async () => {
      const result = await applyComputedFields(testUser, userComputedFields);

      expect(result.id).toBe(testUser.id);
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
    });

    it('should handle async compute functions', async () => {
      const result = await applyComputedFields(testUser, userComputedFields);

      expect(result.asyncGreeting).toBe('Hello, John!');
    });

    it('should return original record when no computed fields config', async () => {
      const result = await applyComputedFields(testUser, undefined);

      expect((result as unknown as Record<string, unknown>).fullName).toBeUndefined();
      expect(result.firstName).toBe('John');
    });
  });

  describe('applyComputedFieldsToArray', () => {
    it('should compute fields for multiple records', async () => {
      const testUsers: User[] = [
        testUser,
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          firstName: 'Jane',
          lastName: 'Smith',
          birthDate: '1985-12-20',
          status: 'active',
          emailVerified: false,
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440003',
          firstName: 'Bob',
          lastName: 'Wilson',
          birthDate: '2000-01-01',
          status: 'pending',
          emailVerified: false,
        },
      ];

      const result = await applyComputedFieldsToArray(testUsers, userComputedFields);

      expect(result.length).toBe(3);
      expect(result[0].fullName).toBe('John Doe');
      expect(result[1].fullName).toBe('Jane Smith');
      expect(result[2].fullName).toBe('Bob Wilson');
    });

    it('should compute isFullyActive correctly for different users', async () => {
      const testUsers: User[] = [
        { ...testUser, status: 'active', emailVerified: true },
        { ...testUser, id: '2', status: 'active', emailVerified: false },
        { ...testUser, id: '3', status: 'pending', emailVerified: true },
      ];

      const result = await applyComputedFieldsToArray(testUsers, userComputedFields);

      expect(result[0].isFullyActive).toBe(true);
      expect(result[1].isFullyActive).toBe(false);
      expect(result[2].isFullyActive).toBe(false);
    });
  });

  describe('Model definition with computed fields', () => {
    it('should allow computed fields in model definition', () => {
      const UserModel = defineModel({
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        computedFields: userComputedFields,
      });

      expect(UserModel.computedFields).toBeDefined();
      expect(UserModel.computedFields?.fullName).toBeDefined();
      expect(typeof UserModel.computedFields?.fullName.compute).toBe('function');
    });

    it('should preserve computed fields in meta definition', () => {
      const UserModel = defineModel({
        tableName: 'users',
        schema: UserSchema,
        primaryKeys: ['id'],
        computedFields: userComputedFields,
      });

      const userMeta = defineMeta({ model: UserModel });

      expect(userMeta.model.computedFields).toBeDefined();
    });
  });
});
