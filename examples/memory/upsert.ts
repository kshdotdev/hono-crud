/**
 * Example: Upsert Operations
 *
 * Demonstrates create-or-update functionality with various configurations.
 *
 * Run with: npx tsx examples/upsert.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryUpsertEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage
clearStorage();

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

const UserSettingsSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.string().default('en'),
  notifications: z.boolean().default(true),
});

type Product = z.infer<typeof ProductSchema>;
type UserSettings = z.infer<typeof UserSettingsSchema>;

// ============================================================================
// Model Definitions
// ============================================================================

const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
});

const UserSettingsModel = defineModel({
  tableName: 'user_settings',
  schema: UserSettingsSchema,
  primaryKeys: ['id'],
});

const productMeta = defineMeta({ model: ProductModel });
const settingsMeta = defineMeta({ model: UserSettingsModel });

// ============================================================================
// Endpoints
// ============================================================================

// Upsert products by SKU
// Useful for syncing product data from external systems
class ProductUpsert extends MemoryUpsertEndpoint {
  _meta = productMeta;
  upsertKeys = ['sku']; // Find existing product by SKU
  createOnlyFields = ['createdAt'];

  async beforeCreate(data: Partial<Product>) {
    return { ...data, createdAt: new Date().toISOString() };
  }

  async beforeUpdate(data: Partial<Product>, existing: Product) {
    return { ...data, updatedAt: new Date().toISOString() };
  }
}

// Upsert user settings by userId
// Perfect for "get or create" settings patterns
class UserSettingsUpsert extends MemoryUpsertEndpoint {
  _meta = settingsMeta;
  upsertKeys = ['userId']; // One settings record per user
}

class ProductList extends MemoryListEndpoint {
  _meta = productMeta;
}

class UserSettingsList extends MemoryListEndpoint {
  _meta = settingsMeta;
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());
app.put('/products', ProductUpsert);
app.get('/products', ProductList);
app.put('/settings', UserSettingsUpsert);
app.get('/settings', UserSettingsList);

// ============================================================================
// Demo
// ============================================================================

async function main() {
  console.log('=== Upsert Operations Demo ===\n');

  // 1. Upsert a new product
  console.log('1. Creating a new product via upsert...');
  const res1 = await app.request('/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: 'LAPTOP-001',
      name: 'Gaming Laptop',
      price: 1299.99,
      stock: 50,
    }),
  });

  const result1 = await res1.json();
  console.log(`  Status: ${res1.status} (${result1.created ? 'Created' : 'Updated'})`);
  console.log('  Product:', JSON.stringify(result1.result, null, 2));
  console.log();

  // 2. Upsert same SKU - should update
  console.log('2. Updating product via upsert (same SKU)...');
  const res2 = await app.request('/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: 'LAPTOP-001', // Same SKU
      name: 'Gaming Laptop Pro', // Updated name
      price: 1499.99, // Updated price
      stock: 45, // Updated stock
    }),
  });

  const result2 = await res2.json();
  console.log(`  Status: ${res2.status} (${result2.created ? 'Created' : 'Updated'})`);
  console.log(`  Same ID: ${result2.result.id === result1.result.id}`);
  console.log('  Product:', JSON.stringify(result2.result, null, 2));
  console.log();

  // 3. Upsert another product
  console.log('3. Creating another product...');
  const res3 = await app.request('/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: 'PHONE-001',
      name: 'Smartphone',
      price: 799.99,
      stock: 100,
    }),
  });

  const result3 = await res3.json();
  console.log(`  Status: ${res3.status} (${result3.created ? 'Created' : 'Updated'})`);
  console.log();

  // 4. User settings - create
  console.log('4. Creating user settings via upsert...');
  const res4 = await app.request('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user-123',
      theme: 'dark',
      language: 'en',
    }),
  });

  const result4 = await res4.json();
  console.log(`  Status: ${res4.status} (${result4.created ? 'Created' : 'Updated'})`);
  console.log('  Settings:', JSON.stringify(result4.result, null, 2));
  console.log();

  // 5. User settings - update
  console.log('5. Updating user settings via upsert...');
  const res5 = await app.request('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user-123', // Same user
      theme: 'light', // Changed theme
      notifications: false, // Disable notifications
    }),
  });

  const result5 = await res5.json();
  console.log(`  Status: ${res5.status} (${result5.created ? 'Created' : 'Updated'})`);
  console.log(`  Same ID: ${result5.result.id === result4.result.id}`);
  console.log('  Settings:', JSON.stringify(result5.result, null, 2));
  console.log();

  // 6. List all products
  console.log('6. Listing all products...');
  const listRes = await app.request('/products');
  const listResult = await listRes.json();
  console.log(`  Total products: ${listResult.result.length}`);
  for (const product of listResult.result) {
    console.log(`    - ${product.sku}: ${product.name} ($${product.price})`);
  }
  console.log();

  console.log('=== Demo Complete ===');
}

main().catch(console.error);
