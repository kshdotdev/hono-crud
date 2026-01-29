/**
 * Tests for aggregation functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  defineModel,
  parseAggregateField,
  parseAggregateQuery,
  computeAggregations,
} from '../src/index.js';
import {
  MemoryAggregateEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// Define test schema
const ProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  quantity: z.number(),
  isActive: z.boolean().default(true),
  deletedAt: z.date().nullable().optional(),
});

// Define model
const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
});

// Test endpoint
class ProductAggregate extends MemoryAggregateEndpoint {
  _meta = { model: ProductModel };

  aggregateConfig = {
    sumFields: ['price', 'quantity'],
    avgFields: ['price', 'quantity'],
    minMaxFields: ['price', 'quantity'],
    countDistinctFields: ['category'],
    groupByFields: ['category', 'isActive'],
  };
}

describe('Aggregations', () => {
  beforeEach(() => {
    clearStorage();

    // Seed test data
    const store = getStorage<Record<string, unknown>>('products');

    const products = [
      { id: '1', name: 'Laptop', category: 'electronics', price: 999, quantity: 10, isActive: true },
      { id: '2', name: 'Phone', category: 'electronics', price: 599, quantity: 25, isActive: true },
      { id: '3', name: 'Tablet', category: 'electronics', price: 399, quantity: 15, isActive: false },
      { id: '4', name: 'Desk', category: 'furniture', price: 299, quantity: 5, isActive: true },
      { id: '5', name: 'Chair', category: 'furniture', price: 199, quantity: 20, isActive: true },
      { id: '6', name: 'Lamp', category: 'furniture', price: 49, quantity: 50, isActive: false },
      { id: '7', name: 'Book', category: 'books', price: 19, quantity: 100, isActive: true },
      { id: '8', name: 'Notebook', category: 'books', price: 9, quantity: 200, isActive: true },
    ];

    for (const product of products) {
      store.set(product.id, product);
    }
  });

  describe('parseAggregateField', () => {
    it('should parse count:*', () => {
      const result = parseAggregateField('count:*');
      expect(result).toEqual({ operation: 'count', field: '*', alias: undefined });
    });

    it('should parse sum:price', () => {
      const result = parseAggregateField('sum:price');
      expect(result).toEqual({ operation: 'sum', field: 'price', alias: undefined });
    });

    it('should parse avg:price:averagePrice', () => {
      const result = parseAggregateField('avg:price:averagePrice');
      expect(result).toEqual({ operation: 'avg', field: 'price', alias: 'averagePrice' });
    });

    it('should parse countDistinct (case insensitive)', () => {
      const result = parseAggregateField('countdistinct:category');
      expect(result).toEqual({ operation: 'countDistinct', field: 'category', alias: undefined });
    });

    it('should return null for invalid operation', () => {
      const result = parseAggregateField('invalid:field');
      expect(result).toBeNull();
    });

    it('should return null for missing field', () => {
      const result = parseAggregateField('count');
      expect(result).toBeNull();
    });
  });

  describe('parseAggregateQuery', () => {
    it('should parse count parameter', () => {
      const result = parseAggregateQuery({ count: '*' });
      expect(result.aggregations).toHaveLength(1);
      expect(result.aggregations[0]).toEqual({ operation: 'count', field: '*' });
    });

    it('should parse multiple aggregations', () => {
      const result = parseAggregateQuery({
        count: 'id',
        sum: 'price',
        avg: 'quantity',
      });
      expect(result.aggregations).toHaveLength(3);
    });

    it('should parse groupBy', () => {
      const result = parseAggregateQuery({ count: '*', groupBy: 'category,isActive' });
      expect(result.groupBy).toEqual(['category', 'isActive']);
    });

    it('should parse having conditions', () => {
      const result = parseAggregateQuery({
        count: '*',
        groupBy: 'category',
        'having[count][gte]': '5',
      });
      expect(result.having).toEqual({ count: { gte: '5' } });
    });

    it('should parse orderBy and direction', () => {
      const result = parseAggregateQuery({
        count: '*',
        groupBy: 'category',
        orderBy: 'count',
        orderDirection: 'desc',
      });
      expect(result.orderBy).toBe('count');
      expect(result.orderDirection).toBe('desc');
    });

    it('should parse pagination', () => {
      const result = parseAggregateQuery({
        count: '*',
        groupBy: 'category',
        limit: '10',
        offset: '5',
      });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it('should collect filters', () => {
      const result = parseAggregateQuery({
        count: '*',
        isActive: 'true',
        category: 'electronics',
      });
      expect(result.filters).toEqual({ isActive: 'true', category: 'electronics' });
    });
  });

  describe('computeAggregations', () => {
    const records = [
      { id: '1', category: 'A', value: 10 },
      { id: '2', category: 'A', value: 20 },
      { id: '3', category: 'B', value: 30 },
      { id: '4', category: 'B', value: 40 },
      { id: '5', category: 'B', value: 50 },
    ];

    it('should compute COUNT(*)', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'count', field: '*' }],
      });
      expect(result.values?.count).toBe(5);
    });

    it('should compute SUM', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'sum', field: 'value' }],
      });
      expect(result.values?.sumValue).toBe(150);
    });

    it('should compute AVG', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'avg', field: 'value' }],
      });
      expect(result.values?.avgValue).toBe(30);
    });

    it('should compute MIN', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'min', field: 'value' }],
      });
      expect(result.values?.minValue).toBe(10);
    });

    it('should compute MAX', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'max', field: 'value' }],
      });
      expect(result.values?.maxValue).toBe(50);
    });

    it('should compute COUNT DISTINCT', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'countDistinct', field: 'category' }],
      });
      expect(result.values?.countDistinctCategory).toBe(2);
    });

    it('should group by field', () => {
      const result = computeAggregations(records, {
        aggregations: [
          { operation: 'count', field: '*' },
          { operation: 'sum', field: 'value' },
        ],
        groupBy: ['category'],
      });

      expect(result.groups).toHaveLength(2);
      expect(result.totalGroups).toBe(2);

      const groupA = result.groups!.find(g => g.key.category === 'A');
      const groupB = result.groups!.find(g => g.key.category === 'B');

      expect(groupA?.values.count).toBe(2);
      expect(groupA?.values.sumValue).toBe(30);
      expect(groupB?.values.count).toBe(3);
      expect(groupB?.values.sumValue).toBe(120);
    });

    it('should apply HAVING filter', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'count', field: '*' }],
        groupBy: ['category'],
        having: { count: { gte: 3 } },
      });

      expect(result.groups).toHaveLength(1);
      expect(result.groups![0].key.category).toBe('B');
    });

    it('should order by aggregated value', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'sum', field: 'value' }],
        groupBy: ['category'],
        orderBy: 'sumValue',
        orderDirection: 'desc',
      });

      expect(result.groups![0].key.category).toBe('B'); // 120
      expect(result.groups![1].key.category).toBe('A'); // 30
    });

    it('should apply pagination', () => {
      const result = computeAggregations(records, {
        aggregations: [{ operation: 'count', field: '*' }],
        groupBy: ['category'],
        limit: 1,
        offset: 0,
      });

      expect(result.groups).toHaveLength(1);
      expect(result.totalGroups).toBe(2); // Total before pagination
    });
  });

  describe('MemoryAggregateEndpoint', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();

      app.onError((err, c) => {
        return c.json({ success: false, error: { message: err.message } }, 400);
      });

      app.get('/products/aggregate', async (c) => {
        const endpoint = new ProductAggregate();
        endpoint.setContext(c);
        return endpoint.handle();
      });
    });

    it('should return count of all records', async () => {
      const response = await app.request('/products/aggregate?count=*');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.count).toBe(8);
    });

    it('should compute sum of prices', async () => {
      const response = await app.request('/products/aggregate?sum=price');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.sumPrice).toBe(2572); // Sum of all prices
    });

    it('should compute average price', async () => {
      const response = await app.request('/products/aggregate?avg=price');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.avgPrice).toBe(321.5); // 2572 / 8
    });

    it('should compute min and max', async () => {
      const response = await app.request('/products/aggregate?min=price&max=price');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.minPrice).toBe(9);
      expect(result.result.values.maxPrice).toBe(999);
    });

    it('should group by category', async () => {
      const response = await app.request('/products/aggregate?count=*&groupBy=category');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { groups: Array<{ key: { category: string }; values: { count: number } }> } };

      expect(result.result.groups).toHaveLength(3);

      const electronics = result.result.groups.find(g => g.key.category === 'electronics');
      const furniture = result.result.groups.find(g => g.key.category === 'furniture');
      const books = result.result.groups.find(g => g.key.category === 'books');

      expect(electronics?.values.count).toBe(3);
      expect(furniture?.values.count).toBe(3);
      expect(books?.values.count).toBe(2);
    });

    it('should compute multiple aggregations with groupBy', async () => {
      const response = await app.request('/products/aggregate?count=*&sum=price&avg=price&groupBy=category');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { groups: Array<{ key: { category: string }; values: Record<string, number> }> } };

      const electronics = result.result.groups.find(g => g.key.category === 'electronics');
      expect(electronics?.values.count).toBe(3);
      expect(electronics?.values.sumPrice).toBe(1997); // 999 + 599 + 399
      expect(electronics?.values.avgPrice).toBeCloseTo(665.67, 1);
    });

    it('should filter before aggregation', async () => {
      const response = await app.request('/products/aggregate?count=*&isActive=true');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.count).toBe(6); // Only active products
    });

    it('should apply having filter', async () => {
      const response = await app.request('/products/aggregate?count=*&groupBy=category&having[count][gte]=3');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { groups: Array<{ key: { category: string } }> } };

      expect(result.result.groups).toHaveLength(2); // electronics (3) and furniture (3)
    });

    it('should order by aggregated value', async () => {
      const response = await app.request('/products/aggregate?sum=price&groupBy=category&orderBy=sumPrice&orderDirection=desc');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { groups: Array<{ key: { category: string } }> } };

      // electronics (1997) > furniture (547) > books (28)
      expect(result.result.groups[0].key.category).toBe('electronics');
      expect(result.result.groups[1].key.category).toBe('furniture');
      expect(result.result.groups[2].key.category).toBe('books');
    });

    it('should count distinct categories', async () => {
      const response = await app.request('/products/aggregate?countDistinct=category');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.countDistinctCategory).toBe(3);
    });

    it('should default to COUNT(*) if no aggregation specified', async () => {
      const response = await app.request('/products/aggregate');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { values: Record<string, number> } };
      expect(result.result.values.count).toBe(8);
    });

    it('should group by multiple fields', async () => {
      const response = await app.request('/products/aggregate?count=*&groupBy=category,isActive');

      expect(response.status).toBe(200);
      const result = await response.json() as { result: { groups: Array<{ key: { category: string; isActive: string } }> } };

      // Should have groups for each category + isActive combination
      expect(result.result.groups.length).toBeGreaterThan(3);
    });
  });
});
