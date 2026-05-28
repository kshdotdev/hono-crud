import {
  type FieldSelection,
  type FieldSelectionConfig,
  applyFieldSelection,
  applyFieldSelectionToArray,
  parseFieldSelection,
} from 'hono-crud';
/**
 * Tests for Field Selection functionality.
 */
import { describe, expect, it } from 'vitest';

// ============================================================================
// Test Data
// ============================================================================

const testRecord = {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
  password: 'secret123',
  role: 'admin',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-15',
};

const testRecords = [
  testRecord,
  {
    id: '456',
    name: 'Jane Smith',
    email: 'jane@example.com',
    password: 'secret456',
    role: 'user',
    createdAt: '2024-01-02',
    updatedAt: '2024-01-16',
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('Field Selection', () => {
  describe('parseFieldSelection', () => {
    it('should parse comma-separated field names', () => {
      const selection = parseFieldSelection('id,name,email', {}, [
        'id',
        'name',
        'email',
        'password',
        'role',
        'createdAt',
      ]);

      expect(selection.isActive).toBe(true);
      expect(selection.fields).toHaveLength(3);
      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).toContain('email');
    });

    it('should filter out blocked fields', () => {
      const config: FieldSelectionConfig = {
        blockedFields: ['password'],
      };
      const selection = parseFieldSelection('id,name,password', config, [
        'id',
        'name',
        'email',
        'password',
        'role',
      ]);

      expect(selection.fields).not.toContain('password');
      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
    });

    it('should only include allowed fields when configured', () => {
      const config: FieldSelectionConfig = {
        allowedFields: ['id', 'name', 'email'],
      };
      const selection = parseFieldSelection('id,name,role,password', config, [
        'id',
        'name',
        'email',
        'password',
        'role',
      ]);

      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).not.toContain('role');
      expect(selection.fields).not.toContain('password');
    });

    it('should always include specified fields', () => {
      const config: FieldSelectionConfig = {
        alwaysIncludeFields: ['id'],
      };
      const selection = parseFieldSelection('name,email', config, [
        'id',
        'name',
        'email',
        'password',
        'role',
      ]);

      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).toContain('email');
    });

    it('should handle empty string parameter', () => {
      const selection = parseFieldSelection('', {}, ['id', 'name', 'email']);
      expect(selection.isActive).toBe(false);
    });

    it('should handle null parameter', () => {
      const selection = parseFieldSelection(null, {}, ['id', 'name', 'email']);
      expect(selection.isActive).toBe(false);
    });

    it('should handle undefined parameter', () => {
      const selection = parseFieldSelection(undefined, {}, ['id', 'name', 'email']);
      expect(selection.isActive).toBe(false);
    });

    it('should apply default fields when no parameter provided', () => {
      const config: FieldSelectionConfig = {
        defaultFields: ['id', 'name'],
        alwaysIncludeFields: ['createdAt'],
      };
      const selection = parseFieldSelection(undefined, config, [
        'id',
        'name',
        'email',
        'password',
        'role',
        'createdAt',
      ]);

      expect(selection.isActive).toBe(false);
      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).toContain('createdAt');
    });

    it('should support computed and relation fields', () => {
      const selection = parseFieldSelection(
        'id,name,fullName,posts',
        {},
        ['id', 'name', 'email'],
        ['fullName', 'age'], // computed fields
        ['posts', 'profile'], // relation fields
      );

      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).toContain('fullName');
      expect(selection.fields).toContain('posts');
    });

    it('should allow disabling computed fields', () => {
      const config: FieldSelectionConfig = {
        allowComputedFields: false,
      };
      const selection = parseFieldSelection(
        'id,name,fullName',
        config,
        ['id', 'name'],
        ['fullName'],
        [],
      );

      expect(selection.fields).toContain('id');
      expect(selection.fields).toContain('name');
      expect(selection.fields).not.toContain('fullName');
    });
  });

  describe('applyFieldSelection', () => {
    it('should select only specified fields from record', () => {
      const selection: FieldSelection = { fields: ['id', 'name', 'email'], isActive: true };
      const result = applyFieldSelection(testRecord, selection);

      expect(result.id).toBe('123');
      expect(result.name).toBe('John Doe');
      expect(result.email).toBe('john@example.com');
      expect('password' in result).toBe(false);
      expect('role' in result).toBe(false);
    });

    it('should return all fields when selection is inactive', () => {
      const selection: FieldSelection = { fields: [], isActive: false };
      const result = applyFieldSelection(testRecord, selection);

      expect(Object.keys(result).length).toBe(Object.keys(testRecord).length);
      expect(result.password).toBe('secret123');
    });
  });

  describe('applyFieldSelectionToArray', () => {
    it('should apply field selection to multiple records', () => {
      const selection: FieldSelection = { fields: ['id', 'name'], isActive: true };
      const result = applyFieldSelectionToArray(testRecords, selection);

      expect(result).toHaveLength(2);
      expect(Object.keys(result[0])).toHaveLength(2);
      expect(Object.keys(result[1])).toHaveLength(2);
      expect(result[0].name).toBe('John Doe');
      expect(result[1].name).toBe('Jane Smith');
    });
  });
});
