/**
 * Tests for Upsert functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../src/index.js';
import {
  MemoryUpsertEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// ============================================================================
// Schema Definitions
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['admin', 'user']).default('user'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const SubscriptionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  planId: z.string(),
  status: z.enum(['active', 'inactive', 'cancelled']),
  startDate: z.string(),
});

type User = z.infer<typeof UserSchema>;
type Subscription = z.infer<typeof SubscriptionSchema>;

// ============================================================================
// Model Definitions
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
});

const SubscriptionModel = defineModel({
  tableName: 'subscriptions',
  schema: SubscriptionSchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });
const subscriptionMeta = defineMeta({ model: SubscriptionModel });

// ============================================================================
// Endpoint Classes
// ============================================================================

// Upsert by email (standard pattern)
class UserUpsert extends MemoryUpsertEndpoint {
  _meta = userMeta;
  upsertKeys = ['email'];
  createOnlyFields = ['createdAt'];
  updateOnlyFields = ['updatedAt'];

  async beforeCreate(data: Partial<User>) {
    return { ...data, createdAt: new Date().toISOString() };
  }

  async beforeUpdate(data: Partial<User>, existing: User) {
    return { ...data, updatedAt: new Date().toISOString() };
  }
}

// Upsert by email (native upsert pattern)
class UserNativeUpsert extends MemoryUpsertEndpoint {
  _meta = userMeta;
  upsertKeys = ['email'];
  protected useNativeUpsert = true;
}

// Upsert by composite key (userId + planId)
class SubscriptionUpsert extends MemoryUpsertEndpoint {
  _meta = subscriptionMeta;
  upsertKeys = ['userId', 'planId'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
}

// ============================================================================
// Tests
// ============================================================================

describe('Upsert', () => {
  let app: ReturnType<typeof fromHono>;
  let userStore: Map<string, User>;
  let subscriptionStore: Map<string, Subscription>;

  beforeEach(() => {
    clearStorage();
    userStore = getStorage<User>('users');
    subscriptionStore = getStorage<Subscription>('subscriptions');

    app = fromHono(new Hono());
    app.put('/users', UserUpsert);
    app.put('/users/native', UserNativeUpsert);
    app.get('/users/:id', UserRead);
    app.get('/users', UserList);
    app.put('/subscriptions', SubscriptionUpsert);
  });

  describe('single key upsert', () => {
    it('should create new record when not exists', async () => {
      const response = await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john@example.com',
          name: 'John Doe',
          role: 'admin',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; created: boolean; result: User };
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.result.email).toBe('john@example.com');
      expect(result.result.createdAt).toBeDefined();
      expect(result.result.updatedAt).toBeUndefined();
    });

    it('should update existing record when found by upsert key', async () => {
      // First create
      const createRes = await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john@example.com',
          name: 'John Doe',
          role: 'admin',
        }),
      });
      const createResult = await createRes.json() as { result: User };
      const userId = createResult.result.id;

      // Then upsert with same email
      const response = await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john@example.com',
          name: 'John Doe Updated',
          role: 'user',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { created: boolean; result: User };
      expect(result.created).toBe(false);
      expect(result.result.id).toBe(userId);
      expect(result.result.name).toBe('John Doe Updated');
      expect(result.result.role).toBe('user');
      expect(result.result.updatedAt).toBeDefined();
    });

    it('should create new record with different upsert key', async () => {
      // First create
      await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john@example.com',
          name: 'John Doe',
        }),
      });

      // Then upsert with different email
      const response = await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'jane@example.com',
          name: 'Jane Smith',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { created: boolean };
      expect(result.created).toBe(true);
      expect(userStore.size).toBe(2);
    });
  });

  describe('composite key upsert', () => {
    let userId: string;

    beforeEach(async () => {
      // Create a user first
      const response = await app.request('/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          name: 'Test User',
        }),
      });
      const result = await response.json() as { result: User };
      userId = result.result.id;
    });

    it('should create subscription with composite key', async () => {
      const response = await app.request('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          planId: 'premium',
          status: 'active',
          startDate: '2024-01-01',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { created: boolean };
      expect(result.created).toBe(true);
    });

    it('should update subscription when composite key matches', async () => {
      // First create
      const createRes = await app.request('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          planId: 'premium',
          status: 'active',
          startDate: '2024-01-01',
        }),
      });
      const createResult = await createRes.json() as { result: Subscription };
      const subId = createResult.result.id;

      // Then upsert with same composite key
      const response = await app.request('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          planId: 'premium',
          status: 'cancelled',
          startDate: '2024-01-01',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { created: boolean; result: Subscription };
      expect(result.created).toBe(false);
      expect(result.result.id).toBe(subId);
      expect(result.result.status).toBe('cancelled');
    });

    it('should create new subscription when composite key differs', async () => {
      // First create with premium plan
      await app.request('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          planId: 'premium',
          status: 'active',
          startDate: '2024-01-01',
        }),
      });

      // Then upsert with different planId
      const response = await app.request('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          planId: 'basic',
          status: 'active',
          startDate: '2024-06-01',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { created: boolean };
      expect(result.created).toBe(true);
      expect(subscriptionStore.size).toBe(2);
    });
  });

  describe('native upsert', () => {
    it('should create new record when not exists using native upsert', async () => {
      const response = await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'native@example.com',
          name: 'Native User',
          role: 'admin',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; created: boolean; result: User };
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.result.email).toBe('native@example.com');
      expect(result.result.name).toBe('Native User');
    });

    it('should update existing record using native upsert', async () => {
      // First create
      const createRes = await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'native@example.com',
          name: 'Native User',
          role: 'admin',
        }),
      });
      const createResult = await createRes.json() as { result: User };
      const userId = createResult.result.id;

      // Then upsert with same email
      const response = await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'native@example.com',
          name: 'Native User Updated',
          role: 'user',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { created: boolean; result: User };
      expect(result.created).toBe(false);
      expect(result.result.id).toBe(userId);
      expect(result.result.name).toBe('Native User Updated');
      expect(result.result.role).toBe('user');
    });

    it('should maintain same ID for native upsert updates', async () => {
      // Create two different users
      await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user1@example.com',
          name: 'User 1',
        }),
      });

      const user2Res = await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user2@example.com',
          name: 'User 2',
        }),
      });
      const user2 = (await user2Res.json() as { result: User }).result;

      // Update user2 via native upsert
      const updateRes = await app.request('/users/native', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user2@example.com',
          name: 'User 2 Updated',
        }),
      });
      const updated = (await updateRes.json() as { result: User }).result;

      expect(updated.id).toBe(user2.id);
      expect(updated.name).toBe('User 2 Updated');
      expect(userStore.size).toBe(2);
    });
  });
});
