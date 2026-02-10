/**
 * Example: Upsert Operations with Drizzle + PostgreSQL
 *
 * Demonstrates upsert (create-or-update) functionality:
 * - Single upsert: PUT /products
 * - Batch upsert: PUT /inventory/sync
 *
 * Upsert is useful for:
 * - Syncing data from external systems
 * - "Get or create" patterns
 * - Idempotent data imports
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/upsert.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { pgTable, text, integer, timestamp, uuid, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { fromHono, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  DrizzleUpsertEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import { db, pool, initDb } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// Product Schema & Table (Single Upsert Example)
// ============================================================================

const ProductSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  price: z.number(),
  stock: z.number().default(0),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

type Product = z.infer<typeof ProductSchema>;

// Create products table
async function createProductsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

// Drizzle table definition (for reference)
const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  stock: integer('stock').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
  table: products,
});

const productMeta = defineMeta({ model: ProductModel });

// ============================================================================
// Inventory Schema & Table (Batch Upsert Example)
// ============================================================================

const InventorySchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  warehouseId: z.string(),
  quantity: z.number(),
  lastSyncedAt: z.date().optional(),
});

type Inventory = z.infer<typeof InventorySchema>;

async function createInventoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sku TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      last_synced_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(sku, warehouse_id)
    )
  `);
}

const inventory = pgTable('inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  quantity: integer('quantity').notNull().default(0),
  lastSyncedAt: timestamp('last_synced_at').defaultNow(),
});

const InventoryModel = defineModel({
  tableName: 'inventory',
  schema: InventorySchema,
  primaryKeys: ['id'],
  table: inventory,
});

const inventoryMeta = defineMeta({ model: InventoryModel });

// ============================================================================
// Endpoint Definitions
// ============================================================================

// Upsert products by SKU
class ProductUpsert extends DrizzleUpsertEndpoint {
  _meta = productMeta;
  db = typedDb;

  schema = {
    tags: ['Products'],
    summary: 'Upsert a product',
    description: 'Creates a new product or updates existing one by SKU.',
  };

  // Find existing products by SKU
  upsertKeys = ['sku'];

  // Don't update createdAt on update
  createOnlyFields = ['createdAt'];

  async beforeCreate(data: Partial<Product>) {
    return {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async beforeUpdate(data: Partial<Product>, existing: Product) {
    return {
      ...data,
      updatedAt: new Date(),
    };
  }
}

class ProductList extends DrizzleListEndpoint {
  _meta = productMeta;
  db = typedDb;

  schema = { tags: ['Products'], summary: 'List products' };
  searchFields = ['name', 'sku'];
  sortFields = ['name', 'price', 'stock'];
}

// Batch upsert inventory by SKU + warehouseId (composite key)
class InventoryBatchUpsert extends DrizzleBatchUpsertEndpoint {
  _meta = inventoryMeta;
  db = typedDb;

  schema = {
    tags: ['Inventory'],
    summary: 'Batch upsert inventory',
    description: 'Sync inventory data for multiple SKU/warehouse combinations.',
  };

  // Composite upsert key
  upsertKeys = ['sku', 'warehouseId'];
  maxBatchSize = 1000;

  async beforeItem(data: Partial<Inventory>, index: number, isCreate: boolean) {
    return {
      ...data,
      lastSyncedAt: new Date(),
    };
  }
}

class InventoryList extends DrizzleListEndpoint {
  _meta = inventoryMeta;
  db = typedDb;

  schema = { tags: ['Inventory'], summary: 'List inventory' };
  filterFields = ['sku', 'warehouseId'];
  sortFields = ['sku', 'warehouseId', 'quantity'];
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

// Product endpoints
app.put('/products', ProductUpsert);
app.get('/products', ProductList);

// Inventory endpoints
app.put('/inventory/sync', InventoryBatchUpsert);
app.get('/inventory', InventoryList);

// Clear data endpoint
app.get('/clear', async (c) => {
  await pool.query('TRUNCATE products, inventory CASCADE');
  return c.json({ success: true, message: 'Data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Upsert Operations Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates single and batch upsert operations.',
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

async function init() {
  await initDb();
  await createProductsTable();
  await createInventoryTable();
}

init()
  .then(() => {
    console.log(`
=== Upsert Operations Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, clear any existing data:
  curl http://localhost:${port}/clear

SINGLE UPSERT (Products by SKU):

1. Create a new product:
   curl -X PUT http://localhost:${port}/products \\
     -H "Content-Type: application/json" \\
     -d '{"sku": "LAPTOP-001", "name": "Gaming Laptop", "price": 1299.99, "stock": 50}'

2. Update the same product (same SKU):
   curl -X PUT http://localhost:${port}/products \\
     -H "Content-Type: application/json" \\
     -d '{"sku": "LAPTOP-001", "name": "Gaming Laptop Pro", "price": 1499.99, "stock": 45}'

3. List products (notice same ID, updated values):
   curl http://localhost:${port}/products

BATCH UPSERT (Inventory by SKU + Warehouse):

4. Initial inventory sync:
   curl -X PUT http://localhost:${port}/inventory/sync \\
     -H "Content-Type: application/json" \\
     -d '[
       {"sku": "LAPTOP-001", "warehouseId": "WH-EAST", "quantity": 50},
       {"sku": "LAPTOP-001", "warehouseId": "WH-WEST", "quantity": 30},
       {"sku": "PHONE-001", "warehouseId": "WH-EAST", "quantity": 200}
     ]'

5. Incremental sync (updates existing, creates new):
   curl -X PUT http://localhost:${port}/inventory/sync \\
     -H "Content-Type: application/json" \\
     -d '[
       {"sku": "LAPTOP-001", "warehouseId": "WH-EAST", "quantity": 45},
       {"sku": "PHONE-001", "warehouseId": "WH-WEST", "quantity": 100}
     ]'

6. List inventory:
   curl http://localhost:${port}/inventory

Response includes:
- created: true/false - Whether the record was created (vs updated)
- result: The created/updated record
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
