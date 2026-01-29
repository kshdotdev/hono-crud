import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../src/adapters/memory/index.js';
import type { MetaInput, Model } from '../src/index.js';

// Define test schema
const TestSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user']),
  age: z.number().optional(),
});

type TestItem = z.infer<typeof TestSchema>;

const TestModel: Model<typeof TestSchema> = {
  tableName: 'test_items',
  schema: TestSchema,
  primaryKeys: ['id'],
};

type TestMeta = MetaInput<typeof TestSchema>;
const testMeta: TestMeta = { model: TestModel };

// Create endpoint classes
class TestCreate extends MemoryCreateEndpoint<any, TestMeta> {
  _meta = testMeta;
}

class TestList extends MemoryListEndpoint<any, TestMeta> {
  _meta = testMeta;
  filterFields = ['role'];
  filterConfig = {
    age: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
  };
  searchFields = ['name', 'email'];
  orderByFields = ['name', 'age'];
}

class TestRead extends MemoryReadEndpoint<any, TestMeta> {
  _meta = testMeta;
}

class TestUpdate extends MemoryUpdateEndpoint<any, TestMeta> {
  _meta = testMeta;
}

class TestDelete extends MemoryDeleteEndpoint<any, TestMeta> {
  _meta = testMeta;
}

describe('Memory Adapter', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(() => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/items', {
      create: TestCreate as any,
      list: TestList as any,
      read: TestRead as any,
      update: TestUpdate as any,
      delete: TestDelete as any,
    });
  });

  describe('Create', () => {
    it('should create a new item', async () => {
      const res = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          role: 'user',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.result.name).toBe('John Doe');
      expect(data.result.email).toBe('john@example.com');
      expect(data.result.id).toBeDefined();
    });

    it('should validate required fields', async () => {
      const res = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John',
          // missing email and role
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      // @hono/zod-openapi returns ZodError format
      expect(data.error).toBeDefined();
    });
  });

  describe('Read', () => {
    it('should read an existing item', async () => {
      // Create first
      const createRes = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'admin',
        }),
      });
      const created = await createRes.json();

      // Read
      const readRes = await app.request(`/items/${created.result.id}`);
      expect(readRes.status).toBe(200);
      const data = await readRes.json();
      expect(data.success).toBe(true);
      expect(data.result.name).toBe('Jane Doe');
    });

    it('should return 404 for non-existent item', async () => {
      const res = await app.request('/items/non-existent-id');
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Update', () => {
    it('should update an existing item', async () => {
      // Create first
      const createRes = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bob',
          email: 'bob@example.com',
          role: 'user',
        }),
      });
      const created = await createRes.json();

      // Update
      const updateRes = await app.request(`/items/${created.result.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bobby',
        }),
      });

      expect(updateRes.status).toBe(200);
      const data = await updateRes.json();
      expect(data.success).toBe(true);
      expect(data.result.name).toBe('Bobby');
      expect(data.result.email).toBe('bob@example.com');
    });
  });

  describe('Delete', () => {
    it('should delete an existing item', async () => {
      // Create first
      const createRes = await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Delete Me',
          email: 'delete@example.com',
          role: 'user',
        }),
      });
      const created = await createRes.json();

      // Delete
      const deleteRes = await app.request(`/items/${created.result.id}`, {
        method: 'DELETE',
      });

      expect(deleteRes.status).toBe(200);
      const data = await deleteRes.json();
      expect(data.success).toBe(true);
      expect(data.result.deleted).toBe(true);

      // Verify deleted
      const readRes = await app.request(`/items/${created.result.id}`);
      expect(readRes.status).toBe(404);
    });
  });

  describe('List', () => {
    beforeEach(async () => {
      // Create test data
      const items = [
        { name: 'Alice', email: 'alice@example.com', role: 'admin', age: 30 },
        { name: 'Bob', email: 'bob@example.com', role: 'user', age: 25 },
        { name: 'Charlie', email: 'charlie@example.com', role: 'user', age: 35 },
        { name: 'Diana', email: 'diana@example.com', role: 'admin', age: 28 },
      ];

      for (const item of items) {
        await app.request('/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
      }
    });

    it('should list all items', async () => {
      const res = await app.request('/items');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.result.length).toBe(4);
      expect(data.result_info.total_count).toBe(4);
    });

    it('should filter by role', async () => {
      const res = await app.request('/items?role=admin');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.length).toBe(2);
      expect(data.result.every((item: TestItem) => item.role === 'admin')).toBe(true);
    });

    it('should search by name', async () => {
      const res = await app.request('/items?search=alice');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.length).toBe(1);
      expect(data.result[0].name).toBe('Alice');
    });

    it('should filter with operators', async () => {
      const res = await app.request('/items?age[gte]=30');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.length).toBe(2);
      expect(data.result.every((item: TestItem) => (item.age || 0) >= 30)).toBe(true);
    });

    it('should paginate results', async () => {
      const res = await app.request('/items?page=1&per_page=2');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.length).toBe(2);
      expect(data.result_info.page).toBe(1);
      expect(data.result_info.per_page).toBe(2);
      expect(data.result_info.total_pages).toBe(2);
    });

    it('should sort by name', async () => {
      const res = await app.request('/items?order_by=name&order_by_direction=asc');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result[0].name).toBe('Alice');
      expect(data.result[3].name).toBe('Diana');
    });
  });
});
