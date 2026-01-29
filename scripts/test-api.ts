/**
 * API Test Runner
 *
 * Tests both Drizzle and Prisma comprehensive examples against local PostgreSQL.
 * Saves all responses as JSON files for comparison.
 *
 * Prerequisites:
 * 1. cd examples && docker compose up -d
 * 2. npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. npx prisma db push --schema=examples/prisma/schema.prisma
 *
 * Run: npx tsx scripts/test-api.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:3456';
const DRIZZLE_OUTPUT = join(process.cwd(), 'tests/api-responses/drizzle');
const PRISMA_OUTPUT = join(process.cwd(), 'tests/api-responses/prisma');

// Test IDs for created resources (will be set during test execution)
let createdUserId: string | null = null;
let batchCreatedUserIds: string[] = [];

interface TestCase {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string | (() => string);
  body?: object | (() => object);
  description: string;
  setup?: () => void;
}

const testCases: TestCase[] = [
  // Health & Basic List
  { name: 'health', method: 'GET', endpoint: '/health', description: 'Health check' },
  { name: 'list-users', method: 'GET', endpoint: '/users', description: 'List all users' },
  {
    name: 'read-user',
    method: 'GET',
    endpoint: '/users/a0000000-0000-0000-0000-000000000001',
    description: 'Get single user',
  },
  {
    name: 'list-users-with-relations',
    method: 'GET',
    endpoint: '/users?include=posts,profile',
    description: 'Users with relations',
  },

  // Filtering
  { name: 'filter-by-role', method: 'GET', endpoint: '/users?role=admin', description: 'Filter by role' },
  { name: 'filter-by-age', method: 'GET', endpoint: '/users?age[gte]=25', description: 'Filter by age (gte)' },

  // Search & Sort
  { name: 'search-users', method: 'GET', endpoint: '/users?search=alice', description: 'Search users' },
  {
    name: 'sort-users',
    method: 'GET',
    endpoint: '/users?order_by=name&order_by_direction=asc',
    description: 'Sort users',
  },

  // Posts
  { name: 'list-posts', method: 'GET', endpoint: '/posts', description: 'List posts' },
  {
    name: 'posts-with-relations',
    method: 'GET',
    endpoint: '/posts?include=author,comments',
    description: 'Posts with relations',
  },

  // Categories
  { name: 'list-categories', method: 'GET', endpoint: '/categories', description: 'List categories' },

  // Create operations
  {
    name: 'create-user',
    method: 'POST',
    endpoint: '/users',
    body: {
      email: 'testuser@example.com',
      name: 'Test User',
      role: 'user',
      age: 30,
      status: 'active',
    },
    description: 'Create a new user',
  },

  // Update (uses created user ID)
  {
    name: 'update-user',
    method: 'PATCH',
    endpoint: () => `/users/${createdUserId || 'a0000000-0000-0000-0000-000000000001'}`,
    body: { name: 'Updated Test User', age: 31 },
    description: 'Update a user',
  },

  // Upsert
  {
    name: 'upsert-category',
    method: 'PUT',
    endpoint: '/categories',
    body: { name: 'Music', description: 'Music related posts', sortOrder: 4 },
    description: 'Upsert a category',
  },

  // Batch create
  {
    name: 'batch-create',
    method: 'POST',
    endpoint: '/users/batch',
    body: {
      items: [
        { email: 'batch1@example.com', name: 'Batch User 1', role: 'user', age: 25, status: 'active' },
        { email: 'batch2@example.com', name: 'Batch User 2', role: 'guest', age: 22, status: 'pending' },
      ],
    },
    description: 'Batch create users',
  },

  // Soft delete (delete one of the batch created users)
  {
    name: 'soft-delete',
    method: 'DELETE',
    endpoint: () => `/users/${batchCreatedUserIds[0] || 'a0000000-0000-0000-0000-000000000003'}`,
    description: 'Soft delete a user',
  },

  // List with deleted
  {
    name: 'list-with-deleted',
    method: 'GET',
    endpoint: '/users?withDeleted=true',
    description: 'List including soft deleted',
  },

  // Restore
  {
    name: 'restore-user',
    method: 'POST',
    endpoint: () => `/users/${batchCreatedUserIds[0] || 'a0000000-0000-0000-0000-000000000003'}/restore`,
    description: 'Restore soft deleted',
  },
];

interface TestResult {
  test: string;
  adapter: string;
  request: {
    method: string;
    url: string;
    body: object | null;
  };
  response: {
    status: number;
    body: unknown;
  };
  timestamp: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 30, delay = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(delay);
  }
  return false;
}

async function startServer(script: string): Promise<ChildProcess> {
  console.log(`\n🚀 Starting server: ${script}`);

  const child = spawn('npx', ['tsx', script], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3456' },
  });

  child.stdout?.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Server running')) {
      console.log('   Server started successfully');
    }
  });

  child.stderr?.on('data', (data) => {
    const output = data.toString();
    // Ignore common warnings
    if (!output.includes('ExperimentalWarning')) {
      console.error(`   Server error: ${output}`);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServer();
  if (!ready) {
    throw new Error('Server failed to start within timeout');
  }

  return child;
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    console.log('   Stopping server...');
    child.on('exit', () => resolve());
    child.kill('SIGTERM');
    // Force kill after 5 seconds
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
  });
}

async function executeTest(test: TestCase, adapter: string): Promise<TestResult> {
  const endpoint = typeof test.endpoint === 'function' ? test.endpoint() : test.endpoint;
  const body = typeof test.body === 'function' ? test.body() : test.body;
  const url = `${BASE_URL}${endpoint}`;

  const options: RequestInit = {
    method: test.method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(test.method)) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    // Track created resources for subsequent tests
    if (test.name === 'create-user' && response.ok && responseBody && typeof responseBody === 'object') {
      createdUserId = (responseBody as { id?: string }).id || null;
    }

    if (test.name === 'batch-create' && response.ok && responseBody && typeof responseBody === 'object') {
      const items = (responseBody as { items?: Array<{ id: string }> }).items;
      if (Array.isArray(items)) {
        batchCreatedUserIds = items.map((item) => item.id);
      }
    }

    return {
      test: test.name,
      adapter,
      request: {
        method: test.method,
        url: endpoint,
        body: body || null,
      },
      response: {
        status: response.status,
        body: responseBody,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      test: test.name,
      adapter,
      request: {
        method: test.method,
        url: endpoint,
        body: body || null,
      },
      response: {
        status: 0,
        body: { error: error instanceof Error ? error.message : 'Unknown error' },
      },
      timestamp: new Date().toISOString(),
    };
  }
}

async function seedData(): Promise<void> {
  console.log('   Seeding test data...');
  const response = await fetch(`${BASE_URL}/seed`);
  if (!response.ok) {
    throw new Error(`Failed to seed data: ${response.status}`);
  }
}

async function runTests(adapter: 'drizzle' | 'prisma', script: string, outputDir: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running tests for ${adapter.toUpperCase()}`);
  console.log('='.repeat(60));

  // Reset tracked IDs
  createdUserId = null;
  batchCreatedUserIds = [];

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let server: ChildProcess | null = null;

  try {
    server = await startServer(script);
    await seedData();

    for (const test of testCases) {
      console.log(`   Testing: ${test.name} - ${test.description}`);

      const result = await executeTest(test, adapter);
      const filename = `${test.name}.json`;
      const filepath = join(outputDir, filename);

      writeFileSync(filepath, JSON.stringify(result, null, 2));

      const statusIcon = result.response.status >= 200 && result.response.status < 300 ? '✅' : '❌';
      console.log(`   ${statusIcon} ${test.name}: ${result.response.status}`);
    }
  } finally {
    if (server) {
      await stopServer(server);
    }
  }
}

async function resetDatabase(): Promise<void> {
  console.log('\n🔄 Resetting database schema...');
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/hono_crud',
  });

  try {
    await pool.query(`
      DROP TABLE IF EXISTS comments, posts, profiles, users, categories CASCADE;
      DROP TYPE IF EXISTS user_role, user_status, post_status CASCADE;
      DROP TYPE IF EXISTS "UserRole", "UserStatus", "PostStatus" CASCADE;
    `);
    console.log('   Database schema cleared');
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  console.log('🧪 API Test Runner');
  console.log('==================');
  console.log(`Output directories:`);
  console.log(`  Drizzle: ${DRIZZLE_OUTPUT}`);
  console.log(`  Prisma:  ${PRISMA_OUTPUT}`);

  try {
    // Reset database before Drizzle tests
    await resetDatabase();

    // Test Drizzle
    await runTests('drizzle', 'examples/drizzle/comprehensive.ts', DRIZZLE_OUTPUT);

    // Reset database before Prisma tests (to use Prisma's enum naming)
    await resetDatabase();

    // Push Prisma schema to create tables with Prisma's conventions
    console.log('\n📦 Pushing Prisma schema...');
    const { execSync } = await import('child_process');
    execSync('npx prisma db push --schema=examples/prisma/schema.prisma --config=examples/prisma/prisma.config.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    // Small delay for schema to settle
    await sleep(1000);

    // Test Prisma
    await runTests('prisma', 'examples/prisma/comprehensive.ts', PRISMA_OUTPUT);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60));
    console.log('\nResults saved to:');
    console.log(`  - ${DRIZZLE_OUTPUT}/*.json`);
    console.log(`  - ${PRISMA_OUTPUT}/*.json`);
  } catch (error) {
    console.error('\n❌ Test runner failed:', error);
    process.exit(1);
  }
}

main();
