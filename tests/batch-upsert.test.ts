/**
 * Tests for Batch Upsert functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../src/index.js';
import {
  MemoryBatchUpsertEndpoint,
  MemoryListEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// ============================================================================
// Schema Definitions
// ============================================================================

const ProductSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  price: z.number(),
  stock: z.number().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const SettingsSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  key: z.string(),
  value: z.string(),
});

type Product = z.infer<typeof ProductSchema>;
type Settings = z.infer<typeof SettingsSchema>;

// ============================================================================
// Model Definitions
// ============================================================================

const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
});

const SettingsModel = defineModel({
  tableName: 'settings',
  schema: SettingsSchema,
  primaryKeys: ['id'],
});

const productMeta = defineMeta({ model: ProductModel });
const settingsMeta = defineMeta({ model: SettingsModel });

// ============================================================================
// Endpoint Classes
// ============================================================================

// Batch upsert products by SKU
class ProductBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = productMeta;
  upsertKeys = ['sku'];
  createOnlyFields = ['createdAt'];
  maxBatchSize = 50;

  async beforeItem(data: Partial<Product>, index: number, isCreate: boolean) {
    if (isCreate) {
      return { ...data, createdAt: new Date().toISOString() };
    }
    return { ...data, updatedAt: new Date().toISOString() };
  }
}

// Batch upsert settings with composite key
class SettingsBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = settingsMeta;
  upsertKeys = ['userId', 'key']; // Composite key
  continueOnError = true;
}

class ProductList extends MemoryListEndpoint {
  _meta = productMeta;
}

// ============================================================================
// Tests
// ============================================================================

describe('Batch Upsert', () => {
  let app: ReturnType<typeof fromHono>;
  let productStore: Map<string, Product>;
  let settingsStore: Map<string, Settings>;

  beforeEach(() => {
    clearStorage();
    productStore = getStorage<Product>('products');
    settingsStore = getStorage<Settings>('settings');

    app = fromHono(new Hono());
    app.put('/products/batch', ProductBatchUpsert);
    app.get('/products', ProductList);
    app.put('/settings/batch', SettingsBatchUpsert);
  });

  it('should create new records when they do not exist', async () => {
    const response = await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1', price: 29.99, stock: 100 },
        { sku: 'PROD-002', name: 'Product 2', price: 39.99, stock: 50 },
        { sku: 'PROD-003', name: 'Product 3', price: 49.99, stock: 25 },
      ]),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { success: boolean; result: { createdCount: number; updatedCount: number; totalCount: number; items: Array<{ created: boolean }> } };
    expect(result.success).toBe(true);
    expect(result.result.createdCount).toBe(3);
    expect(result.result.updatedCount).toBe(0);
    expect(result.result.totalCount).toBe(3);
    expect(result.result.items.every(i => i.created === true)).toBe(true);
  });

  it('should update existing records by upsert key', async () => {
    // First create some records
    await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1', price: 29.99, stock: 100 },
        { sku: 'PROD-002', name: 'Product 2', price: 39.99, stock: 50 },
      ]),
    });

    // Now update them
    const response = await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1 Updated', price: 24.99 },
        { sku: 'PROD-002', name: 'Product 2 Updated', price: 34.99 },
      ]),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { result: { createdCount: number; updatedCount: number; items: Array<{ created: boolean }> } };
    expect(result.result.createdCount).toBe(0);
    expect(result.result.updatedCount).toBe(2);
    expect(result.result.items.every(i => i.created === false)).toBe(true);

    // Verify data was updated
    const prod1 = [...productStore.values()].find(p => p.sku === 'PROD-001');
    expect(prod1?.name).toBe('Product 1 Updated');
    expect(prod1?.price).toBe(24.99);
  });

  it('should handle mixed creates and updates', async () => {
    // First create some records
    await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1', price: 29.99 },
        { sku: 'PROD-002', name: 'Product 2', price: 39.99 },
      ]),
    });

    // Mixed batch
    const response = await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1 V3', price: 19.99 },  // Update
        { sku: 'PROD-004', name: 'Product 4', price: 59.99 },     // Create
        { sku: 'PROD-002', name: 'Product 2 V3', price: 29.99 },  // Update
        { sku: 'PROD-005', name: 'Product 5', price: 69.99 },     // Create
      ]),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { result: { createdCount: number; updatedCount: number; totalCount: number } };
    expect(result.result.createdCount).toBe(2);
    expect(result.result.updatedCount).toBe(2);
    expect(result.result.totalCount).toBe(4);
  });

  it('should support composite upsert keys', async () => {
    // Create initial settings
    const createRes = await app.request('/settings/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { userId: 'user-1', key: 'theme', value: 'dark' },
        { userId: 'user-1', key: 'language', value: 'en' },
        { userId: 'user-2', key: 'theme', value: 'light' },
      ]),
    });

    const createResult = await createRes.json() as { result: { createdCount: number } };
    expect(createResult.result.createdCount).toBe(3);

    // Update with composite key
    const updateRes = await app.request('/settings/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { userId: 'user-1', key: 'theme', value: 'system' },  // Update existing
        { userId: 'user-2', key: 'language', value: 'es' },   // Create new
      ]),
    });

    const updateResult = await updateRes.json() as { result: { createdCount: number; updatedCount: number } };
    expect(updateResult.result.createdCount).toBe(1);
    expect(updateResult.result.updatedCount).toBe(1);

    // Verify composite key matching
    const user1Theme = [...settingsStore.values()].find(
      s => s.userId === 'user-1' && s.key === 'theme'
    );
    expect(user1Theme?.value).toBe('system');
  });

  it('should apply createOnlyFields correctly', async () => {
    // Create a product
    await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1', price: 29.99 },
      ]),
    });

    // Update it
    await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1 Updated', price: 24.99 },
      ]),
    });

    const prod = [...productStore.values()].find(p => p.sku === 'PROD-001');
    expect(prod?.createdAt).toBeDefined();
    expect(prod?.updatedAt).toBeDefined();
  });

  it('should track item indices in results', async () => {
    // First create a product
    await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-001', name: 'Product 1', price: 10 },
      ]),
    });

    // Mixed batch
    const response = await app.request('/products/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sku: 'PROD-006', name: 'Product 6', price: 10 },    // index 0: create
        { sku: 'PROD-001', name: 'Product 1 V4', price: 15 }, // index 1: update
        { sku: 'PROD-007', name: 'Product 7', price: 20 },    // index 2: create
      ]),
    });

    const result = await response.json() as { result: { items: Array<{ index: number; created: boolean }> } };
    expect(result.result.items[0].index).toBe(0);
    expect(result.result.items[1].index).toBe(1);
    expect(result.result.items[2].index).toBe(2);
    expect(result.result.items[0].created).toBe(true);
    expect(result.result.items[1].created).toBe(false);
    expect(result.result.items[2].created).toBe(true);
  });
});
