/**
 * Example: Batch Upsert Operations
 *
 * Demonstrates creating or updating multiple records in a single request.
 * Perfect for data synchronization, bulk imports, and batch processing.
 *
 * Run with: npx tsx examples/batch-upsert.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryBatchUpsertEndpoint,
  MemoryListEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage
clearStorage();

// ============================================================================
// Schema Definitions
// ============================================================================

const InventorySchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  warehouseId: z.string(),
  quantity: z.number(),
  lastSyncedAt: z.string().optional(),
});

const PriceSchema = z.object({
  id: z.uuid(),
  productId: z.string(),
  region: z.string(),
  price: z.number(),
  currency: z.string(),
  validFrom: z.string(),
});

type Inventory = z.infer<typeof InventorySchema>;
type Price = z.infer<typeof PriceSchema>;

// ============================================================================
// Model Definitions
// ============================================================================

const InventoryModel = defineModel({
  tableName: 'inventory',
  schema: InventorySchema,
  primaryKeys: ['id'],
});

const PriceModel = defineModel({
  tableName: 'prices',
  schema: PriceSchema,
  primaryKeys: ['id'],
});

const inventoryMeta = defineMeta({ model: InventoryModel });
const priceMeta = defineMeta({ model: PriceModel });

// ============================================================================
// Endpoints
// ============================================================================

// Batch upsert inventory by SKU + warehouseId (composite key)
class InventoryBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = inventoryMeta;
  upsertKeys = ['sku', 'warehouseId']; // Composite key
  maxBatchSize = 1000; // Allow large batches

  async beforeItem(data: Partial<Inventory>, index: number, isCreate: boolean) {
    // Always update lastSyncedAt
    return { ...data, lastSyncedAt: new Date().toISOString() };
  }
}

// Batch upsert prices by productId + region (composite key)
class PriceBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = priceMeta;
  upsertKeys = ['productId', 'region']; // One price per product per region
  continueOnError = true; // Continue if one item fails
}

class InventoryList extends MemoryListEndpoint {
  _meta = inventoryMeta;
}

class PriceList extends MemoryListEndpoint {
  _meta = priceMeta;
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());
app.put('/inventory/sync', InventoryBatchUpsert);
app.get('/inventory', InventoryList);
app.put('/prices/sync', PriceBatchUpsert);
app.get('/prices', PriceList);

// ============================================================================
// Demo
// ============================================================================

async function main() {
  console.log('=== Batch Upsert Demo ===\n');

  // =========================================================================
  // Demo 1: Inventory Synchronization
  // =========================================================================
  console.log('1. INVENTORY SYNC - Initial data load\n');

  // Simulate data from external inventory system
  const initialInventory = [
    { sku: 'LAPTOP-001', warehouseId: 'WH-EAST', quantity: 50 },
    { sku: 'LAPTOP-001', warehouseId: 'WH-WEST', quantity: 30 },
    { sku: 'PHONE-001', warehouseId: 'WH-EAST', quantity: 200 },
    { sku: 'PHONE-001', warehouseId: 'WH-WEST', quantity: 150 },
    { sku: 'TABLET-001', warehouseId: 'WH-EAST', quantity: 75 },
  ];

  const syncRes1 = await app.request('/inventory/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initialInventory),
  });

  const syncResult1 = await syncRes1.json();
  console.log('   Initial sync results:');
  console.log(`   - Created: ${syncResult1.result.createdCount}`);
  console.log(`   - Updated: ${syncResult1.result.updatedCount}`);
  console.log(`   - Total: ${syncResult1.result.totalCount}`);
  console.log();

  // =========================================================================
  // Demo 2: Incremental Sync (updates + new data)
  // =========================================================================
  console.log('2. INVENTORY SYNC - Incremental update\n');

  // Simulate updated data from external system
  const updatedInventory = [
    { sku: 'LAPTOP-001', warehouseId: 'WH-EAST', quantity: 45 },  // Update: sold 5
    { sku: 'LAPTOP-001', warehouseId: 'WH-WEST', quantity: 28 },  // Update: sold 2
    { sku: 'PHONE-001', warehouseId: 'WH-CENTRAL', quantity: 100 }, // New warehouse
    { sku: 'MONITOR-001', warehouseId: 'WH-EAST', quantity: 60 },  // New product
  ];

  const syncRes2 = await app.request('/inventory/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedInventory),
  });

  const syncResult2 = await syncRes2.json();
  console.log('   Incremental sync results:');
  console.log(`   - Created: ${syncResult2.result.createdCount} (new locations/products)`);
  console.log(`   - Updated: ${syncResult2.result.updatedCount} (quantity changes)`);
  console.log(`   - Total: ${syncResult2.result.totalCount}`);
  console.log();

  // Show detailed breakdown
  console.log('   Breakdown by item:');
  for (const item of syncResult2.result.items) {
    const action = item.created ? 'CREATED' : 'UPDATED';
    console.log(`   - [${action}] ${item.data.sku} @ ${item.data.warehouseId}: ${item.data.quantity} units`);
  }
  console.log();

  // =========================================================================
  // Demo 3: Regional Pricing Sync
  // =========================================================================
  console.log('3. PRICE SYNC - Multi-region pricing\n');

  const prices = [
    { productId: 'LAPTOP-001', region: 'US', price: 999.99, currency: 'USD', validFrom: '2024-01-01' },
    { productId: 'LAPTOP-001', region: 'EU', price: 899.99, currency: 'EUR', validFrom: '2024-01-01' },
    { productId: 'LAPTOP-001', region: 'UK', price: 799.99, currency: 'GBP', validFrom: '2024-01-01' },
    { productId: 'PHONE-001', region: 'US', price: 599.99, currency: 'USD', validFrom: '2024-01-01' },
    { productId: 'PHONE-001', region: 'EU', price: 549.99, currency: 'EUR', validFrom: '2024-01-01' },
  ];

  const priceRes1 = await app.request('/prices/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prices),
  });

  const priceResult1 = await priceRes1.json();
  console.log('   Initial price sync:');
  console.log(`   - Created: ${priceResult1.result.createdCount}`);
  console.log(`   - Updated: ${priceResult1.result.updatedCount}`);
  console.log();

  // Price update (e.g., promotional pricing)
  const priceUpdates = [
    { productId: 'LAPTOP-001', region: 'US', price: 899.99, currency: 'USD', validFrom: '2024-02-01' }, // Sale!
    { productId: 'LAPTOP-001', region: 'EU', price: 849.99, currency: 'EUR', validFrom: '2024-02-01' }, // Sale!
    { productId: 'LAPTOP-001', region: 'JP', price: 119999, currency: 'JPY', validFrom: '2024-02-01' },  // New region
  ];

  const priceRes2 = await app.request('/prices/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(priceUpdates),
  });

  const priceResult2 = await priceRes2.json();
  console.log('   Price update sync:');
  console.log(`   - Created: ${priceResult2.result.createdCount} (new regions)`);
  console.log(`   - Updated: ${priceResult2.result.updatedCount} (price changes)`);
  console.log();

  // =========================================================================
  // Demo 4: View Synced Data
  // =========================================================================
  console.log('4. VIEW SYNCED DATA\n');

  const inventoryRes = await app.request('/inventory');
  const inventoryList = await inventoryRes.json();
  console.log('   Inventory Records:');
  for (const inv of inventoryList.result) {
    console.log(`   - ${inv.sku} @ ${inv.warehouseId}: ${inv.quantity} units (synced: ${inv.lastSyncedAt})`);
  }
  console.log();

  const priceRes = await app.request('/prices');
  const priceList = await priceRes.json();
  console.log('   Price Records:');
  for (const price of priceList.result) {
    console.log(`   - ${price.productId} [${price.region}]: ${price.price} ${price.currency}`);
  }
  console.log();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('5. SUMMARY\n');
  console.log(`   Total inventory records: ${inventoryList.result.length}`);
  console.log(`   Total price records: ${priceList.result.length}`);
  console.log();

  console.log('=== Demo Complete ===');
}

main().catch(console.error);
