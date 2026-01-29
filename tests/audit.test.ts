/**
 * Tests for audit logging functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  defineModel,
  AuditLogger,
  MemoryAuditLogStorage,
  createAuditLogger,
  setAuditStorage,
  getAuditStorage,
  calculateChanges,
} from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// Define test schema
const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(['admin', 'user']),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Define model with audit enabled
const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  audit: {
    enabled: true,
    actions: ['create', 'update', 'delete'],
    trackChanges: true,
    storeRecord: true,
    storePreviousRecord: true,
    excludeFields: ['createdAt', 'updatedAt'],
  },
});

// Define model without audit
const NonAuditedModel = defineModel({
  tableName: 'non_audited',
  schema: UserSchema,
  primaryKeys: ['id'],
});

// Test endpoints
class UserCreate extends MemoryCreateEndpoint {
  _meta = {
    model: UserModel,
  };
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = {
    model: UserModel,
  };
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = {
    model: UserModel,
  };
}

describe('Audit Logging', () => {
  let auditStorage: MemoryAuditLogStorage;

  beforeEach(() => {
    clearStorage();
    auditStorage = new MemoryAuditLogStorage();
    setAuditStorage(auditStorage);
  });

  describe('AuditLogger', () => {
    it('should create audit logger with config', () => {
      const logger = createAuditLogger(UserModel.audit);
      expect(logger).toBeInstanceOf(AuditLogger);
    });

    it('should check if action is enabled', () => {
      const logger = createAuditLogger(UserModel.audit);
      expect(logger.isEnabled('create')).toBe(true);
      expect(logger.isEnabled('update')).toBe(true);
      expect(logger.isEnabled('delete')).toBe(true);
      expect(logger.isEnabled('restore')).toBe(false); // Not in actions list
    });

    it('should log create operation', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };

      await logger.logCreate('users', '123', record, 'user-456');

      const logs = auditStorage.getAllLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
      expect(logs[0].tableName).toBe('users');
      expect(logs[0].recordId).toBe('123');
      expect(logs[0].userId).toBe('user-456');
      expect(logs[0].record).toEqual(record);
    });

    it('should log update operation with changes', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const previousRecord = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };
      const newRecord = { id: '123', name: 'John Doe', email: 'john.doe@test.com', role: 'user' };

      await logger.logUpdate('users', '123', previousRecord, newRecord, 'user-456');

      const logs = auditStorage.getAllLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('update');
      expect(logs[0].previousRecord).toEqual(previousRecord);
      expect(logs[0].record).toEqual(newRecord);
      expect(logs[0].changes).toHaveLength(2);
      expect(logs[0].changes).toContainEqual({
        field: 'name',
        oldValue: 'John',
        newValue: 'John Doe',
      });
      expect(logs[0].changes).toContainEqual({
        field: 'email',
        oldValue: 'john@test.com',
        newValue: 'john.doe@test.com',
      });
    });

    it('should log delete operation', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };

      await logger.logDelete('users', '123', record, 'user-456');

      const logs = auditStorage.getAllLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('delete');
      expect(logs[0].previousRecord).toEqual(record);
    });

    it('should exclude fields from audit', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record = {
        id: '123',
        name: 'John',
        email: 'john@test.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await logger.logCreate('users', '123', record);

      const logs = auditStorage.getAllLogs();
      expect(logs[0].record).not.toHaveProperty('createdAt');
      expect(logs[0].record).not.toHaveProperty('updatedAt');
      expect(logs[0].record).toHaveProperty('name');
    });

    it('should not log when audit is disabled', async () => {
      const logger = createAuditLogger(undefined, auditStorage);
      const record = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };

      await logger.logCreate('users', '123', record);

      const logs = auditStorage.getAllLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe('MemoryAuditLogStorage', () => {
    it('should retrieve logs by record ID', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record1 = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };
      const record2 = { id: '456', name: 'Jane', email: 'jane@test.com', role: 'user' };

      await logger.logCreate('users', '123', record1);
      await logger.logCreate('users', '456', record2);
      await logger.logUpdate('users', '123', record1, { ...record1, name: 'John Doe' });

      const logsFor123 = await auditStorage.getByRecordId('users', '123');
      expect(logsFor123).toHaveLength(2);
      expect(logsFor123.every((log) => log.recordId === '123')).toBe(true);
    });

    it('should retrieve all logs with filters', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };

      await logger.logCreate('users', '123', record, 'user-1');
      await logger.logUpdate('users', '123', record, { ...record, name: 'John Doe' }, 'user-2');

      const createLogs = await auditStorage.getAll({ action: 'create' });
      expect(createLogs).toHaveLength(1);

      const user1Logs = await auditStorage.getAll({ userId: 'user-1' });
      expect(user1Logs).toHaveLength(1);
    });

    it('should support pagination', async () => {
      const logger = createAuditLogger(UserModel.audit, auditStorage);
      const record = { id: '123', name: 'John', email: 'john@test.com', role: 'user' };

      // Create multiple logs
      for (let i = 0; i < 10; i++) {
        await logger.logCreate('users', `${i}`, { ...record, id: `${i}` });
      }

      const page1 = await auditStorage.getAll({ limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);

      const page2 = await auditStorage.getAll({ limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
    });
  });

  describe('calculateChanges', () => {
    it('should calculate field changes correctly', () => {
      const oldRecord = { name: 'John', email: 'john@test.com', role: 'user' };
      const newRecord = { name: 'John Doe', email: 'john@test.com', role: 'admin' };

      const changes = calculateChanges(oldRecord, newRecord);

      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({
        field: 'name',
        oldValue: 'John',
        newValue: 'John Doe',
      });
      expect(changes).toContainEqual({
        field: 'role',
        oldValue: 'user',
        newValue: 'admin',
      });
    });

    it('should respect exclude fields', () => {
      const oldRecord = { name: 'John', updatedAt: new Date('2024-01-01') };
      const newRecord = { name: 'John Doe', updatedAt: new Date('2024-01-02') };

      const changes = calculateChanges(oldRecord, newRecord, ['updatedAt']);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('name');
    });

    it('should detect added and removed fields', () => {
      const oldRecord = { name: 'John', oldField: 'value' };
      const newRecord = { name: 'John', newField: 'value' };

      const changes = calculateChanges(oldRecord, newRecord);

      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({
        field: 'oldField',
        oldValue: 'value',
        newValue: undefined,
      });
      expect(changes).toContainEqual({
        field: 'newField',
        oldValue: undefined,
        newValue: 'value',
      });
    });
  });

  describe('Endpoint Integration', () => {
    it('should log create from endpoint', async () => {
      const app = new Hono();
      app.post('/users', async (c) => {
        const endpoint = new UserCreate();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      const response = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John',
          email: 'john@test.com',
          role: 'user',
        }),
      });

      expect(response.status).toBe(201);

      // Wait a bit for fire-and-forget audit log
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = auditStorage.getAllLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].action).toBe('create');
      expect(logs[0].tableName).toBe('users');
    });

    it('should log update from endpoint', async () => {
      // First create a record
      const store = getStorage<Record<string, unknown>>('users');
      store.set('123', {
        id: '123',
        name: 'John',
        email: 'john@test.com',
        role: 'user',
      });

      const app = new Hono();
      app.patch('/users/:id', async (c) => {
        const endpoint = new UserUpdate();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      const response = await app.request('/users/123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
        }),
      });

      expect(response.status).toBe(200);

      // Wait a bit for fire-and-forget audit log
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = auditStorage.getAllLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const updateLog = logs.find((l) => l.action === 'update');
      expect(updateLog).toBeDefined();
      expect(updateLog!.tableName).toBe('users');
    });

    it('should log delete from endpoint', async () => {
      // First create a record
      const store = getStorage<Record<string, unknown>>('users');
      store.set('123', {
        id: '123',
        name: 'John',
        email: 'john@test.com',
        role: 'user',
      });

      const app = new Hono();
      app.delete('/users/:id', async (c) => {
        const endpoint = new UserDelete();
        endpoint.setContext(c);
        return endpoint.handle();
      });

      const response = await app.request('/users/123', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);

      // Wait a bit for fire-and-forget audit log
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = auditStorage.getAllLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const deleteLog = logs.find((l) => l.action === 'delete');
      expect(deleteLog).toBeDefined();
      expect(deleteLog!.tableName).toBe('users');
    });
  });
});
