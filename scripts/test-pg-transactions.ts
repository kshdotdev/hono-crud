/**
 * Test script to verify transaction support with a real PostgreSQL database.
 *
 * Prerequisites:
 * - PostgreSQL running (docker compose -f examples/docker-compose.yml up -d)
 * - Database: hono_crud
 *
 * Run: npx tsx scripts/test-pg-transactions.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { defineModel } from '../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  type DrizzleDatabase,
} from '../src/adapters/drizzle/index.js';

const { Pool } = pg;

// ============================================================================
// Database Setup
// ============================================================================

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'hono_crud',
});

const db = drizzle(pool);

// Drizzle table definition
const usersTable = pgTable('tx_test_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  deletedAt: timestamp('deleted_at'),
});

// Zod schema
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  deletedAt: z.date().nullable().optional(),
});

// Model definition
const UserModel = defineModel({
  tableName: 'tx_test_users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: usersTable,
  softDelete: { field: 'deletedAt' },
});

// ============================================================================
// Endpoint Classes
// ============================================================================

class UserCreateWithTx extends DrizzleCreateEndpoint {
  _meta = { model: UserModel };
  db = db as unknown as DrizzleDatabase;
  protected useTransaction = true;
}

class UserCreateWithTxAndError extends DrizzleCreateEndpoint {
  _meta = { model: UserModel };
  db = db as unknown as DrizzleDatabase;
  protected useTransaction = true;

  override async after(data: z.infer<typeof UserSchema>): Promise<z.infer<typeof UserSchema>> {
    throw new Error('Simulated error in after hook - should rollback');
  }
}

class UserCreateWithoutTx extends DrizzleCreateEndpoint {
  _meta = { model: UserModel };
  db = db as unknown as DrizzleDatabase;
  protected useTransaction = false;
}

class UserUpdateWithTx extends DrizzleUpdateEndpoint {
  _meta = { model: UserModel };
  db = db as unknown as DrizzleDatabase;
  protected useTransaction = true;
}

class UserDeleteWithTx extends DrizzleDeleteEndpoint {
  _meta = { model: UserModel };
  db = db as unknown as DrizzleDatabase;
  protected useTransaction = true;
}

// ============================================================================
// Test Runner
// ============================================================================

async function setup() {
  console.log('Setting up test table...');

  // Drop and recreate table
  await db.execute(sql`DROP TABLE IF EXISTS tx_test_users`);
  await db.execute(sql`
    CREATE TABLE tx_test_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      deleted_at TIMESTAMP
    )
  `);

  console.log('Table created successfully.\n');
}

async function cleanup() {
  await db.execute(sql`DROP TABLE IF EXISTS tx_test_users`);
  await pool.end();
}

async function testCreateWithTransaction() {
  console.log('Test 1: Create with transaction enabled');
  console.log('----------------------------------------');

  const app = new Hono();
  app.post('/users', async (c) => {
    const endpoint = new UserCreateWithTx();
    endpoint.setContext(c);
    return endpoint.handle();
  });

  const response = await app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Transaction User',
      email: 'tx@example.com',
    }),
  });

  const result = await response.json() as { success: boolean; result: { id: string; name: string } };

  if (response.status === 201 && result.success) {
    // Verify in database
    const users = await db.select().from(usersTable);
    const found = users.find(u => u.email === 'tx@example.com');

    if (found) {
      console.log('✅ PASSED: User created successfully with transaction');
      console.log(`   Created: ${found.name} (${found.email})\n`);
      return true;
    }
  }

  console.log('❌ FAILED: User creation with transaction failed');
  console.log(`   Status: ${response.status}`);
  console.log(`   Result: ${JSON.stringify(result)}\n`);
  return false;
}

async function testCreateWithTransactionRollback() {
  console.log('Test 2: Create with transaction rollback on error');
  console.log('-------------------------------------------------');

  // Count users before
  const countBefore = (await db.select().from(usersTable)).length;

  const app = new Hono();
  app.onError((err, c) => {
    return c.json({ success: false, error: { message: err.message } }, 500);
  });
  app.post('/users', async (c) => {
    const endpoint = new UserCreateWithTxAndError();
    endpoint.setContext(c);
    return endpoint.handle();
  });

  const response = await app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Should Rollback',
      email: 'rollback@example.com',
    }),
  });

  const result = await response.json() as { success: boolean; error?: { message: string } };

  // Count users after
  const countAfter = (await db.select().from(usersTable)).length;
  const userExists = (await db.select().from(usersTable)).some(u => u.email === 'rollback@example.com');

  if (response.status === 500 && !userExists && countAfter === countBefore) {
    console.log('✅ PASSED: Transaction rolled back on error');
    console.log(`   Error message: ${result.error?.message}`);
    console.log(`   Users before: ${countBefore}, after: ${countAfter}\n`);
    return true;
  }

  console.log('❌ FAILED: Transaction did not rollback');
  console.log(`   Status: ${response.status}`);
  console.log(`   User exists: ${userExists}`);
  console.log(`   Count before: ${countBefore}, after: ${countAfter}\n`);
  return false;
}

async function testUpdateWithTransaction() {
  console.log('Test 3: Update with transaction enabled');
  console.log('---------------------------------------');

  // Create a user first
  const userId = crypto.randomUUID();
  await db.insert(usersTable).values({
    id: userId,
    name: 'Original Name',
    email: 'update-test@example.com',
  });

  const app = new Hono();
  app.patch('/users/:id', async (c) => {
    const endpoint = new UserUpdateWithTx();
    endpoint.setContext(c);
    return endpoint.handle();
  });

  const response = await app.request(`/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Updated Name' }),
  });

  const result = await response.json() as { success: boolean; result: { name: string } };

  if (response.status === 200 && result.result?.name === 'Updated Name') {
    // Verify in database
    const users = await db.select().from(usersTable);
    const found = users.find(u => u.id === userId);

    if (found?.name === 'Updated Name') {
      console.log('✅ PASSED: User updated successfully with transaction');
      console.log(`   Updated: ${found.name}\n`);
      return true;
    }
  }

  console.log('❌ FAILED: User update with transaction failed');
  console.log(`   Status: ${response.status}`);
  console.log(`   Result: ${JSON.stringify(result)}\n`);
  return false;
}

async function testDeleteWithTransaction() {
  console.log('Test 4: Delete (soft) with transaction enabled');
  console.log('----------------------------------------------');

  // Create a user first
  const userId = crypto.randomUUID();
  await db.insert(usersTable).values({
    id: userId,
    name: 'To Be Deleted',
    email: 'delete-test@example.com',
  });

  const app = new Hono();
  app.delete('/users/:id', async (c) => {
    const endpoint = new UserDeleteWithTx();
    endpoint.setContext(c);
    return endpoint.handle();
  });

  const response = await app.request(`/users/${userId}`, {
    method: 'DELETE',
  });

  const result = await response.json() as { success: boolean; result: { deleted: boolean } };

  if (response.status === 200 && result.result?.deleted) {
    // Verify soft delete in database
    const users = await db.select().from(usersTable);
    const found = users.find(u => u.id === userId);

    if (found?.deletedAt !== null) {
      console.log('✅ PASSED: User soft-deleted successfully with transaction');
      console.log(`   Deleted at: ${found.deletedAt}\n`);
      return true;
    }
  }

  console.log('❌ FAILED: User delete with transaction failed');
  console.log(`   Status: ${response.status}`);
  console.log(`   Result: ${JSON.stringify(result)}\n`);
  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('PostgreSQL Transaction Support Tests');
  console.log('='.repeat(60));
  console.log();

  try {
    await setup();

    const results: boolean[] = [];

    results.push(await testCreateWithTransaction());
    results.push(await testCreateWithTransactionRollback());
    results.push(await testUpdateWithTransaction());
    results.push(await testDeleteWithTransaction());

    console.log('='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));

    const passed = results.filter(r => r).length;
    const total = results.length;

    console.log(`\nTests: ${passed}/${total} passed`);

    if (passed === total) {
      console.log('\n✅ All transaction tests passed!\n');
    } else {
      console.log(`\n❌ ${total - passed} test(s) failed\n`);
      process.exitCode = 1;
    }

  } catch (error) {
    console.error('Test error:', error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
