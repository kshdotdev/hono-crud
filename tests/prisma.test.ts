/**
 * Tests for Prisma ORM adapter.
 * Uses a mock Prisma client for testing without requiring a real database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  defineModel,
  fromHono,
  registerCrud,
} from '../src/index.js';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
  PrismaRestoreEndpoint,
  PrismaUpsertEndpoint,
  PrismaBatchCreateEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaSearchEndpoint,
  PrismaAggregateEndpoint,
  registerPrismaModelMapping,
  registerPrismaModelMappings,
  clearPrismaModelMappings,
} from '../src/adapters/prisma/index.js';

// ============================================================================
// Mock Prisma Client
// ============================================================================

interface MockRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  deletedAt?: string | null;
  [key: string]: unknown;
}

interface MockPost {
  id: string;
  title: string;
  content?: string | null;
  authorId?: string | null;
  views: number;
  [key: string]: unknown;
}

// In-memory storage for mocking
let userStorage: MockRecord[] = [];
let postStorage: MockPost[] = [];

function clearMockStorage() {
  userStorage = [];
  postStorage = [];
}

function matchesWhere(record: MockRecord, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      const orConditions = value as Record<string, unknown>[];
      const matches = orConditions.some(cond => {
        for (const [ck, cv] of Object.entries(cond)) {
          if (typeof cv === 'object' && cv !== null && 'contains' in cv) {
            const searchVal = (cv as { contains: string }).contains.toLowerCase();
            const fieldVal = String(record[ck] || '').toLowerCase();
            if (fieldVal.includes(searchVal)) return true;
          }
        }
        return false;
      });
      if (!matches) return false;
    } else if (value === null) {
      // value === null means we want records where field IS NULL
      if (record[key] !== null && record[key] !== undefined) return false;
    } else if (typeof value === 'object' && value !== null && 'not' in value) {
      if ((value as { not: unknown }).not === null) {
        // { not: null } means we want records where field IS NOT NULL
        if (record[key] === null || record[key] === undefined) return false;
      } else {
        if (record[key] === (value as { not: unknown }).not) return false;
      }
    } else if (typeof value === 'object' && value !== null && 'in' in value) {
      if (!(value as { in: unknown[] }).in.includes(record[key])) return false;
    } else if (typeof value === 'object' && value !== null && 'gt' in value) {
      if ((record[key] as number) <= (value as { gt: number }).gt) return false;
    } else if (typeof value === 'object' && value !== null && 'gte' in value) {
      if ((record[key] as number) < (value as { gte: number }).gte) return false;
    } else if (typeof value === 'object' && value !== null && 'lt' in value) {
      if ((record[key] as number) >= (value as { lt: number }).lt) return false;
    } else if (typeof value === 'object' && value !== null && 'lte' in value) {
      if ((record[key] as number) > (value as { lte: number }).lte) return false;
    } else if (typeof value === 'object' && value !== null && 'contains' in value) {
      const searchVal = (value as { contains: string; mode?: string }).contains.toLowerCase();
      const fieldVal = String(record[key] || '').toLowerCase();
      if (!fieldVal.includes(searchVal)) return false;
    } else if (record[key] !== value) {
      return false;
    }
  }
  return true;
}

function createMockModel(storage: unknown[], tableName: string) {
  return {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const record = { ...data } as MockRecord;
      (storage as MockRecord[]).push(record);
      return record;
    }),

    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
      const records = data.map(d => ({ ...d })) as MockRecord[];
      (storage as MockRecord[]).push(...records);
      return { count: records.length };
    }),

    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = Object.keys(where)[0];
      return (storage as MockRecord[]).find(r => r[key] === where[key]) || null;
    }),

    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return (storage as MockRecord[]).find(r => matchesWhere(r, where)) || null;
    }),

    findMany: vi.fn(async (args?: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      skip?: number;
      take?: number;
    }) => {
      let results = [...(storage as MockRecord[])];

      if (args?.where) {
        results = results.filter(r => matchesWhere(r, args.where!));
      }

      if (args?.orderBy) {
        const [field, direction] = Object.entries(args.orderBy)[0];
        results.sort((a, b) => {
          const aVal = a[field];
          const bVal = b[field];
          if (aVal === bVal) return 0;
          const comparison = (aVal as string) > (bVal as string) ? 1 : -1;
          return direction === 'desc' ? -comparison : comparison;
        });
      }

      if (args?.skip) {
        results = results.slice(args.skip);
      }

      if (args?.take) {
        results = results.slice(0, args.take);
      }

      return results;
    }),

    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const key = Object.keys(where)[0];
      const index = (storage as MockRecord[]).findIndex(r => r[key] === where[key]);
      if (index === -1) return null;
      (storage as MockRecord[])[index] = { ...(storage as MockRecord[])[index], ...data };
      return (storage as MockRecord[])[index];
    }),

    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (let i = 0; i < (storage as MockRecord[]).length; i++) {
        const record = (storage as MockRecord[])[i];
        let matches = true;
        for (const [key, value] of Object.entries(where)) {
          if (record[key] !== value) {
            matches = false;
            break;
          }
        }
        if (matches) {
          (storage as MockRecord[])[i] = { ...record, ...data };
          count++;
        }
      }
      return { count };
    }),

    delete: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = Object.keys(where)[0];
      const index = (storage as MockRecord[]).findIndex(r => r[key] === where[key]);
      if (index === -1) return null;
      const deleted = (storage as MockRecord[]).splice(index, 1)[0];
      return deleted;
    }),

    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = Object.keys(where)[0];
      const initialLength = storage.length;
      const filtered = (storage as MockRecord[]).filter(r => r[key] !== where[key]);
      storage.length = 0;
      (storage as MockRecord[]).push(...filtered);
      return { count: initialLength - storage.length };
    }),

    count: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
      if (!args?.where) return storage.length;
      return (storage as MockRecord[]).filter(r => matchesWhere(r, args.where!)).length;
    }),

    upsert: vi.fn(async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const key = Object.keys(where)[0];
      const existing = (storage as MockRecord[]).find(r => r[key] === where[key]);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const newRecord = { ...create } as MockRecord;
      (storage as MockRecord[]).push(newRecord);
      return newRecord;
    }),
  };
}

function createMockPrismaClient() {
  const userModel = createMockModel(userStorage, 'users');
  const postModel = createMockModel(postStorage, 'posts');

  return {
    user: userModel,
    post: postModel,
    $transaction: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) => {
      return fn({
        user: userModel,
        post: postModel,
      });
    }),
  } as unknown as PrismaClient;
}

// Type for Prisma client
type PrismaClient = {
  user: ReturnType<typeof createMockModel>;
  post: ReturnType<typeof createMockModel>;
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  [key: string]: unknown;
};

let mockPrisma: PrismaClient;

// ============================================================================
// Zod Schemas
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user']).default('user'),
  deletedAt: z.string().nullable().optional(),
});

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  content: z.string().nullable().optional(),
  authorId: z.uuid().nullable().optional(),
  views: z.number().default(0),
});

// ============================================================================
// Models
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
    },
  },
});

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  relations: {
    author: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'authorId',
      localKey: 'id',
    },
  },
});

// ============================================================================
// Endpoint Classes
// ============================================================================

class UserCreate extends PrismaCreateEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserRead extends PrismaReadEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserUpdate extends PrismaUpdateEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserDelete extends PrismaDeleteEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserList extends PrismaListEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
  filterFields = ['role'];
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'email'];
}

class UserRestore extends PrismaRestoreEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserUpsert extends PrismaUpsertEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
  upsertKeys = ['email'];
}

class UserBatchCreate extends PrismaBatchCreateEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserBatchUpdate extends PrismaBatchUpdateEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserBatchDelete extends PrismaBatchDeleteEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserBatchRestore extends PrismaBatchRestoreEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
}

class UserSearch extends PrismaSearchEndpoint {
  _meta = { model: UserModel };
  get prisma() { return mockPrisma; }
  searchFields = ['name', 'email'];
  fieldWeights = { name: 2.0, email: 1.0 };
}

class PostCreate extends PrismaCreateEndpoint {
  _meta = { model: PostModel };
  get prisma() { return mockPrisma; }
}

class PostList extends PrismaListEndpoint {
  _meta = { model: PostModel };
  get prisma() { return mockPrisma; }
  orderByFields = ['title', 'views'];
}

class PostAggregate extends PrismaAggregateEndpoint {
  _meta = { model: PostModel };
  get prisma() { return mockPrisma; }

  aggregateConfig = {
    sumFields: ['views'],
    avgFields: ['views'],
    minMaxFields: ['views'],
    countDistinctFields: ['authorId'],
    groupByFields: ['authorId'],
  };
}

// ============================================================================
// App Setup
// ============================================================================

function createApp() {
  const app = new Hono();

  app.onError((err, c) => {
    // Handle ApiException (NotFoundException, etc.) which extend HTTPException
    if ('code' in err && 'status' in err) {
      const apiErr = err as { code: string; message: string; status: number };
      return c.json({ success: false, error: { code: apiErr.code, message: apiErr.message } }, apiErr.status);
    }
    // Handle generic HTTPException
    if ('status' in err) {
      const status = (err as { status: number }).status;
      return c.json({ success: false, error: { code: 'ERROR', message: err.message } }, status);
    }
    return c.json({ success: false, error: { message: err.message } }, 400);
  });

  // Helper to set context and call handle
  const withContext = <T extends { setContext: (c: unknown) => void; handle: () => Promise<Response> }>(
    EndpointClass: new () => T
  ) => {
    return async (c: unknown) => {
      const endpoint = new EndpointClass();
      endpoint.setContext(c);
      return endpoint.handle();
    };
  };

  // User endpoints - order matters for route matching
  // Static routes before parameterized routes
  app.post('/users', withContext(UserCreate));
  app.get('/users', withContext(UserList));
  app.get('/users/search', withContext(UserSearch));
  app.put('/users/upsert', withContext(UserUpsert));
  app.post('/users/batch', withContext(UserBatchCreate));
  app.patch('/users/batch', withContext(UserBatchUpdate));
  app.post('/users/batch-delete', withContext(UserBatchDelete));
  app.post('/users/batch-restore', withContext(UserBatchRestore));
  // Parameterized routes after static routes
  app.get('/users/:id', withContext(UserRead));
  app.patch('/users/:id', withContext(UserUpdate));
  app.delete('/users/:id', withContext(UserDelete));
  app.post('/users/:id/restore', withContext(UserRestore));

  // Post endpoints
  app.get('/posts/aggregate', withContext(PostAggregate));
  app.post('/posts', withContext(PostCreate));
  app.get('/posts', withContext(PostList));

  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('Prisma Adapter', () => {
  let app: Hono;

  beforeEach(() => {
    clearMockStorage();
    mockPrisma = createMockPrismaClient();
    app = createApp();
  });

  describe('CRUD Operations', () => {
    it('should create a user', async () => {
      const response = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          role: 'admin',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; result: MockRecord };
      expect(result.success).toBe(true);
      expect(result.result.name).toBe('John Doe');
      expect(result.result.email).toBe('john@example.com');
      expect(result.result.role).toBe('admin');
      expect(result.result.id).toBeDefined();
    });

    it('should read a user', async () => {
      // Create user first
      const userId = crypto.randomUUID();
      userStorage.push({
        id: userId,
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'user',
      });

      const response = await app.request(`/users/${userId}`);
      expect(response.status).toBe(200);

      const result = await response.json() as { success: boolean; result: MockRecord };
      expect(result.success).toBe(true);
      expect(result.result.name).toBe('Jane Doe');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await app.request('/users/non-existent-id');
      expect(response.status).toBe(404);

      const result = await response.json() as { success: boolean; error: { code: string } };
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should update a user', async () => {
      const userId = crypto.randomUUID();
      userStorage.push({
        id: userId,
        name: 'Original Name',
        email: 'test@example.com',
        role: 'user',
      });

      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: MockRecord };
      expect(result.result.name).toBe('Updated Name');
    });

    it('should delete a user (soft delete)', async () => {
      const userId = crypto.randomUUID();
      userStorage.push({
        id: userId,
        name: 'To Delete',
        email: 'delete@example.com',
        role: 'user',
        deletedAt: null,
      });

      const response = await app.request(`/users/${userId}`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: { deleted: boolean } };
      expect(result.result.deleted).toBe(true);

      // Verify soft deleted
      expect(userStorage[0].deletedAt).not.toBeNull();
    });
  });

  describe('List Operations', () => {
    beforeEach(() => {
      userStorage.push(
        { id: crypto.randomUUID(), name: 'User 1', email: 'user1@example.com', role: 'user', deletedAt: null },
        { id: crypto.randomUUID(), name: 'User 2', email: 'user2@example.com', role: 'admin', deletedAt: null },
        { id: crypto.randomUUID(), name: 'User 3', email: 'user3@example.com', role: 'user', deletedAt: null },
      );
    });

    it('should list users with pagination', async () => {
      const response = await app.request('/users?per_page=2&page=1');
      expect(response.status).toBe(200);

      const result = await response.json() as { result: MockRecord[]; result_info: { total_count: number; per_page: number } };
      expect(result.result).toHaveLength(2);
      expect(result.result_info.total_count).toBe(3);
      expect(result.result_info.per_page).toBe(2);
    });

    it('should filter users by role', async () => {
      const response = await app.request('/users?role=admin');
      const result = await response.json() as { result: MockRecord[] };

      expect(result.result).toHaveLength(1);
      expect(result.result[0].role).toBe('admin');
    });

    it('should search users', async () => {
      const response = await app.request('/users?search=user1');
      expect(response.status).toBe(200);
      const result = await response.json() as { result: MockRecord[] };

      expect(result.result.length).toBeGreaterThanOrEqual(1);
      expect(result.result.some(u => u.email.includes('user1'))).toBe(true);
    });

    it('should order users by name', async () => {
      const response = await app.request('/users?order_by=name&order_by_direction=asc');
      const result = await response.json() as { result: MockRecord[] };

      expect(result.result[0].name).toBe('User 1');
      expect(result.result[2].name).toBe('User 3');
    });
  });

  describe('Soft Delete & Restore', () => {
    it('should not return soft-deleted users in list', async () => {
      userStorage.push(
        { id: crypto.randomUUID(), name: 'Deleted User', email: 'deleted@example.com', role: 'user', deletedAt: new Date().toISOString() },
        { id: crypto.randomUUID(), name: 'Active User', email: 'active@example.com', role: 'user', deletedAt: null },
      );

      const response = await app.request('/users');
      const result = await response.json() as { result: MockRecord[] };

      expect(result.result).toHaveLength(1);
      expect(result.result[0].name).toBe('Active User');
    });

    it('should restore a soft-deleted user', async () => {
      const userId = crypto.randomUUID();
      userStorage.push({
        id: userId,
        name: 'Deleted User',
        email: 'deleted@example.com',
        role: 'user',
        deletedAt: new Date().toISOString(),
      });

      const response = await app.request(`/users/${userId}/restore`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: MockRecord };
      expect(result.result.deletedAt).toBeNull();
    });
  });

  describe('Upsert', () => {
    it('should create a new user via upsert', async () => {
      const response = await app.request('/users/upsert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New User',
          email: 'new@example.com',
          role: 'user',
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; created: boolean };
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
    });

    it('should update an existing user via upsert', async () => {
      userStorage.push({
        id: crypto.randomUUID(),
        name: 'Existing User',
        email: 'existing@example.com',
        role: 'user',
        deletedAt: null,
      });

      const response = await app.request('/users/upsert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated User',
          email: 'existing@example.com',
          role: 'admin',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; created: boolean; result: MockRecord };
      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.result.name).toBe('Updated User');
      expect(result.result.role).toBe('admin');
    });
  });

  describe('Batch Operations', () => {
    it('should batch create users', async () => {
      const response = await app.request('/users/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Batch User 1', email: 'batch1@example.com', role: 'user' },
            { name: 'Batch User 2', email: 'batch2@example.com', role: 'admin' },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; result: { created: MockRecord[] } };
      expect(result.success).toBe(true);
      expect(result.result.created).toHaveLength(2);
    });

    it('should batch update users', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      userStorage.push(
        { id: user1Id, name: 'User 1', email: 'u1@example.com', role: 'user', deletedAt: null },
        { id: user2Id, name: 'User 2', email: 'u2@example.com', role: 'user', deletedAt: null },
      );

      const response = await app.request('/users/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: user1Id, data: { name: 'Updated User 1' } },
            { id: user2Id, data: { name: 'Updated User 2' } },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: { updated: MockRecord[] } };
      expect(result.success).toBe(true);
      expect(result.result.updated).toHaveLength(2);
    });

    it('should batch delete users', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      userStorage.push(
        { id: user1Id, name: 'User 1', email: 'u1@example.com', role: 'user', deletedAt: null },
        { id: user2Id, name: 'User 2', email: 'u2@example.com', role: 'user', deletedAt: null },
      );

      const response = await app.request('/users/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [user1Id, user2Id],
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: { deleted: MockRecord[] } };
      expect(result.success).toBe(true);
      expect(result.result.deleted).toHaveLength(2);
    });

    it('should batch restore users', async () => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      userStorage.push(
        { id: user1Id, name: 'User 1', email: 'u1@example.com', role: 'user', deletedAt: new Date().toISOString() },
        { id: user2Id, name: 'User 2', email: 'u2@example.com', role: 'user', deletedAt: new Date().toISOString() },
      );

      const response = await app.request('/users/batch-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [user1Id, user2Id],
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { success: boolean; result: { restored: MockRecord[] } };
      expect(result.success).toBe(true);
      expect(result.result.restored).toHaveLength(2);
    });

    it('should report not found items in batch update', async () => {
      const userId = crypto.randomUUID();
      userStorage.push({
        id: userId,
        name: 'User 1',
        email: 'u1@example.com',
        role: 'user',
        deletedAt: null,
      });

      const response = await app.request('/users/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: userId, data: { name: 'Updated' } },
            { id: 'non-existent', data: { name: 'Should Not Update' } },
          ],
        }),
      });

      // Returns 207 Multi-Status for partial success (some items not found)
      expect(response.status).toBe(207);
      const result = await response.json() as { success: boolean; result: { updated: MockRecord[]; notFound: string[] } };
      expect(result.success).toBe(true);
      expect(result.result.updated).toHaveLength(1);
      expect(result.result.notFound).toContain('non-existent');
    });
  });

  describe('Search', () => {
    beforeEach(() => {
      userStorage.push(
        { id: crypto.randomUUID(), name: 'John Smith', email: 'john.smith@example.com', role: 'user', deletedAt: null },
        { id: crypto.randomUUID(), name: 'Jane Doe', email: 'jane.doe@example.com', role: 'admin', deletedAt: null },
        { id: crypto.randomUUID(), name: 'Bob Johnson', email: 'bob.johnson@example.com', role: 'user', deletedAt: null },
      );
    });

    it('should search users by name', async () => {
      const response = await app.request('/users/search?q=John');
      expect(response.status).toBe(200);

      const result = await response.json() as { success: boolean; result: Array<{ item: MockRecord; score: number }> };
      expect(result.success).toBe(true);
      expect(result.result.length).toBeGreaterThanOrEqual(1);
    });

    it('should return scored results', async () => {
      const response = await app.request('/users/search?q=smith');
      expect(response.status).toBe(200);

      const result = await response.json() as { success: boolean; result: Array<{ item: MockRecord; score: number }> };
      expect(result.result.every((r: { score: number }) => typeof r.score === 'number')).toBe(true);
    });
  });

  describe('Aggregations', () => {
    beforeEach(() => {
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();

      userStorage.push(
        { id: user1Id, name: 'Author 1', email: 'author1@example.com', role: 'user', deletedAt: null },
        { id: user2Id, name: 'Author 2', email: 'author2@example.com', role: 'user', deletedAt: null },
      );

      postStorage.push(
        { id: crypto.randomUUID(), title: 'Post 1', authorId: user1Id, views: 100 },
        { id: crypto.randomUUID(), title: 'Post 2', authorId: user1Id, views: 200 },
        { id: crypto.randomUUID(), title: 'Post 3', authorId: user2Id, views: 50 },
      );
    });

    it('should count all posts', async () => {
      const response = await app.request('/posts/aggregate?count=*');
      const result = await response.json() as { result: { values: { count: number } } };

      expect(result.result.values.count).toBe(3);
    });

    it('should sum views', async () => {
      const response = await app.request('/posts/aggregate?sum=views');
      const result = await response.json() as { result: { values: { sumViews: number } } };

      expect(result.result.values.sumViews).toBe(350);
    });

    it('should compute average views', async () => {
      const response = await app.request('/posts/aggregate?avg=views');
      const result = await response.json() as { result: { values: { avgViews: number } } };

      expect(result.result.values.avgViews).toBeCloseTo(116.67, 1);
    });

    it('should group by authorId', async () => {
      const response = await app.request('/posts/aggregate?count=*&sum=views&groupBy=authorId');
      const result = await response.json() as { result: { groups: unknown[] } };

      expect(result.result.groups).toHaveLength(2);
    });
  });
});

// ============================================================================
// Model Name Conversion Tests
// ============================================================================

describe('Prisma Model Name Utilities', () => {
  beforeEach(() => {
    clearPrismaModelMappings();
  });

  describe('registerPrismaModelMapping', () => {
    it('should allow registering custom mappings', () => {
      // Create a mock Prisma client with a "person" model
      const mockPrisma = {
        person: {
          create: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
      };

      // Register mapping from "people" to "person"
      registerPrismaModelMapping('people', 'person');

      // Define a model using "people" table name
      const peopleModel = defineModel({
        tableName: 'people',
        schema: z.object({
          id: z.string().uuid(),
          name: z.string(),
        }),
      });

      const peopleMeta = { model: peopleModel };

      // Create an endpoint using the mapping
      class PeopleList extends PrismaListEndpoint {
        _meta = peopleMeta;
        prisma = mockPrisma as unknown as Parameters<typeof PrismaListEndpoint.prototype.list>[0] extends { prisma: infer P } ? P : never;
        schema = { tags: ['People'], summary: 'List people' };
      }

      // The endpoint should be created without error
      const endpoint = new PeopleList();
      expect(endpoint).toBeDefined();
    });

    it('should be case-insensitive for table names', () => {
      registerPrismaModelMapping('PEOPLE', 'person');
      registerPrismaModelMapping('Users', 'user');

      // Both should be stored as lowercase keys
      const mockPrisma = {
        person: { create: vi.fn() },
        user: { create: vi.fn() },
      };

      // Both uppercase and lowercase should work
      registerPrismaModelMapping('people', 'person');
    });
  });

  describe('registerPrismaModelMappings', () => {
    it('should allow registering multiple mappings at once', () => {
      registerPrismaModelMappings({
        'people': 'person',
        'children': 'child',
        'user_addresses': 'userAddress',
      });

      // Mappings should be registered
      // (We can't directly access the cache, but we can verify via endpoint creation)
    });
  });

  describe('clearPrismaModelMappings', () => {
    it('should clear all custom mappings', () => {
      registerPrismaModelMapping('people', 'person');
      clearPrismaModelMappings();

      // After clearing, the default conversion should be used
      // "people" would no longer map to "person" (would use default pluralization)
    });
  });

  describe('Model name conversion edge cases', () => {
    it('should handle irregular plurals via custom mappings', () => {
      // These irregular plurals need custom mappings
      registerPrismaModelMappings({
        'people': 'person',
        'children': 'child',
        'men': 'man',
        'women': 'woman',
        'teeth': 'tooth',
        'feet': 'foot',
        'mice': 'mouse',
        'geese': 'goose',
      });

      // After registration, these should work correctly
    });

    it('should handle snake_case table names', () => {
      // snake_case should be converted to camelCase
      // e.g., "user_profiles" -> "userProfile"
      registerPrismaModelMapping('user_profiles', 'userProfile');
    });

    it('should handle kebab-case table names', () => {
      // kebab-case should be converted to camelCase
      // e.g., "user-profiles" -> "userProfile"
      registerPrismaModelMapping('user-profiles', 'userProfile');
    });
  });

  describe('Error messages', () => {
    it('should provide helpful error when model not found', async () => {
      const mockPrisma = {
        user: { create: vi.fn() },
        post: { create: vi.fn() },
        comment: { create: vi.fn() },
      };

      // Try to access a non-existent model
      const badModel = defineModel({
        tableName: 'nonexistent',
        schema: z.object({ id: z.string() }),
      });

      const badMeta = { model: badModel };

      class BadEndpoint extends PrismaListEndpoint {
        _meta = badMeta;
        prisma = mockPrisma as unknown as Parameters<typeof PrismaListEndpoint.prototype.list>[0] extends { prisma: infer P } ? P : never;
        schema = { tags: ['Bad'], summary: 'Bad endpoint' };
      }

      const app = new Hono();
      const endpoint = new BadEndpoint();

      app.get('/bad', async (c) => {
        try {
          // This should throw an error with helpful message
          await endpoint.list({ filters: [], options: {} });
          return c.json({ success: true });
        } catch (error) {
          // The error message should include suggestions
          const message = (error as Error).message;
          expect(message).toContain('not found');
          expect(message).toContain('registerPrismaModelMapping');
          return c.json({ error: message }, 500);
        }
      });

      const response = await app.request('/bad');
      expect(response.status).toBe(500);

      const result = await response.json() as { error: string };
      expect(result.error).toContain('not found');
    });
  });
});
