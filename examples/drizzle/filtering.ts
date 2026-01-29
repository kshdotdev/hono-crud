/**
 * Example: Advanced Filtering with Drizzle + PostgreSQL
 *
 * Demonstrates all available filter operators:
 * - eq: Equal to
 * - ne: Not equal to
 * - gt: Greater than
 * - gte: Greater than or equal to
 * - lt: Less than
 * - lte: Less than or equal to
 * - in: In array
 * - nin: Not in array
 * - like: Pattern matching (case-sensitive)
 * - ilike: Pattern matching (case-insensitive)
 * - between: Range query
 * - null: Is null / is not null
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/filtering.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import { UserSchema, CategorySchema, type User, type Category } from '../shared/schemas.js';
import { users, categories } from './schema.js';
import { db, initDb, pool } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// User Model with Advanced Filtering
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
});

const userMeta = defineMeta({ model: UserModel });

class UserCreate extends DrizzleCreateEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'List users with advanced filtering',
    description: `
Supports multiple filter operators:
- \`?role=admin\` - Equal to
- \`?status[ne]=inactive\` - Not equal to
- \`?age[gt]=18\` - Greater than
- \`?age[gte]=18\` - Greater than or equal
- \`?age[lt]=65\` - Less than
- \`?age[lte]=65\` - Less than or equal
- \`?role[in]=admin,user\` - In array
- \`?status[nin]=inactive,pending\` - Not in array
- \`?name[like]=%john%\` - Pattern match (case-sensitive)
- \`?name[ilike]=%john%\` - Pattern match (case-insensitive)
- \`?age[between]=18,30\` - Range query
- \`?age[null]=true\` - Is null
- \`?age[null]=false\` - Is not null
    `,
  };

  // Simple equality filters
  filterFields = ['role', 'status'];

  // Advanced operator filters
  filterConfig = {
    age: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'null'] as const,
    name: ['eq', 'like', 'ilike'] as const,
    email: ['eq', 'like', 'ilike'] as const,
    createdAt: ['gt', 'gte', 'lt', 'lte', 'between'] as const,
  };

  searchFields = ['name', 'email'];
  orderByFields = ['name', 'age', 'createdAt'];
}

// ============================================================================
// Category Model for Additional Filtering Examples
// ============================================================================

const CategoryModel = defineModel({
  tableName: 'categories',
  schema: CategorySchema,
  primaryKeys: ['id'],
  table: categories,
});

const categoryMeta = defineMeta({ model: CategoryModel });

class CategoryCreate extends DrizzleCreateEndpoint {
  _meta = categoryMeta;
  db = typedDb;
  schema = { tags: ['Categories'], summary: 'Create a category' };
}

class CategoryList extends DrizzleListEndpoint {
  _meta = categoryMeta;
  db = typedDb;

  schema = {
    tags: ['Categories'],
    summary: 'List categories with filtering',
    description: 'Filter categories by name, sort order, etc.',
  };

  filterFields = ['name'];
  filterConfig = {
    sortOrder: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
    name: ['like', 'ilike'] as const,
    description: ['null'] as const,
  };

  orderByFields = ['name', 'sortOrder'];
  defaultOrderBy = 'sortOrder';
  defaultOrderDirection: 'asc' | 'desc' = 'asc';
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
});

registerCrud(app, '/categories', {
  create: CategoryCreate,
  list: CategoryList,
});

// Seed endpoint for testing
app.get('/seed', async (c) => {
  // Clear existing data
  await pool.query('TRUNCATE users, categories CASCADE');

  // Seed users with varying ages and statuses
  const userSeedData = [
    { name: 'Alice Admin', email: 'alice@example.com', role: 'admin', age: 35, status: 'active' },
    { name: 'Bob User', email: 'bob@example.com', role: 'user', age: 28, status: 'active' },
    { name: 'Charlie Guest', email: 'charlie@example.com', role: 'guest', age: 22, status: 'pending' },
    { name: 'Diana User', email: 'diana@example.com', role: 'user', age: 45, status: 'active' },
    { name: 'Eve Admin', email: 'eve@example.com', role: 'admin', age: 31, status: 'inactive' },
    { name: 'Frank User', email: 'frank@example.com', role: 'user', age: null, status: 'active' },
    { name: 'Grace Guest', email: 'grace@example.com', role: 'guest', age: 19, status: 'pending' },
    { name: 'Henry User', email: 'henry@example.com', role: 'user', age: 55, status: 'active' },
  ];

  for (const user of userSeedData) {
    await pool.query(
      'INSERT INTO users (email, name, role, age, status) VALUES ($1, $2, $3, $4, $5)',
      [user.email, user.name, user.role, user.age, user.status]
    );
  }

  // Seed categories
  const categorySeedData = [
    { name: 'Technology', description: 'Tech related posts', sortOrder: 1 },
    { name: 'Science', description: 'Scientific articles', sortOrder: 2 },
    { name: 'Art', description: null, sortOrder: 3 },
    { name: 'Music', description: 'Music related content', sortOrder: 4 },
    { name: 'Sports', description: null, sortOrder: 5 },
  ];

  for (const cat of categorySeedData) {
    await pool.query(
      'INSERT INTO categories (name, description, sort_order) VALUES ($1, $2, $3)',
      [cat.name, cat.description, cat.sortOrder]
    );
  }

  return c.json({ success: true, message: 'Seeded 8 users and 5 categories' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Advanced Filtering Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates all available filter operators with hono-crud.',
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Advanced Filtering Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, seed the test data:
  curl http://localhost:${port}/seed

Then try these filter queries:

EQUALITY FILTERS:
  curl "http://localhost:${port}/users?role=admin"
  curl "http://localhost:${port}/users?status=active"

COMPARISON FILTERS:
  curl "http://localhost:${port}/users?age[gt]=30"           # Age > 30
  curl "http://localhost:${port}/users?age[gte]=30"          # Age >= 30
  curl "http://localhost:${port}/users?age[lt]=30"           # Age < 30
  curl "http://localhost:${port}/users?age[between]=25,40"   # 25 <= Age <= 40

IN/NOT IN FILTERS:
  curl "http://localhost:${port}/users?role[in]=admin,user"
  curl "http://localhost:${port}/users?status[nin]=inactive,pending"

PATTERN MATCHING:
  curl "http://localhost:${port}/users?name[ilike]=%alice%"
  curl "http://localhost:${port}/users?email[like]=%example.com"

NULL CHECKS:
  curl "http://localhost:${port}/users?age[null]=true"       # Age is null
  curl "http://localhost:${port}/users?age[null]=false"      # Age is not null

COMBINED FILTERS:
  curl "http://localhost:${port}/users?role=user&age[gte]=30&status=active"

CATEGORIES:
  curl "http://localhost:${port}/categories?sortOrder[lte]=3"
  curl "http://localhost:${port}/categories?description[null]=true"
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
