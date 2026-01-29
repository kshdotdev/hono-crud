/**
 * Example: Upsert Operations with Prisma + PostgreSQL
 *
 * Demonstrates upsert (create-or-update) functionality:
 * - Single upsert: PUT /categories
 * - Batch upsert: PUT /products/sync
 *
 * Upsert is useful for:
 * - Syncing data from external systems
 * - "Get or create" patterns
 * - Idempotent data imports
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. npx prisma db push --schema=examples/prisma/schema.prisma
 * 4. npx tsx examples/prisma/upsert.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  PrismaUpsertEndpoint,
  PrismaBatchUpsertEndpoint,
  PrismaListEndpoint,
} from '../../src/adapters/prisma/index.js';
import { CategorySchema } from '../shared/schemas.js';
import { prisma, initDb, clearDb } from './db.js';

// ============================================================================
// Category Model for Upsert Examples
// ============================================================================

const CategoryModel = defineModel({
  tableName: 'categories',
  schema: CategorySchema,
  primaryKeys: ['id'],
});

const categoryMeta = defineMeta({ model: CategoryModel });

// ============================================================================
// Endpoint Definitions
// ============================================================================

// Upsert categories by name
class CategoryUpsert extends PrismaUpsertEndpoint {
  _meta = categoryMeta;
  prisma = prisma;

  schema = {
    tags: ['Categories'],
    summary: 'Upsert a category',
    description: 'Creates a new category or updates existing one by name.',
  };

  // Find existing categories by name
  upsertKeys = ['name'];

  // Use native Prisma upsert for atomic operation
  useNativeUpsert = true;
}

// Batch upsert categories
class CategoryBatchUpsert extends PrismaBatchUpsertEndpoint {
  _meta = categoryMeta;
  prisma = prisma;

  schema = {
    tags: ['Categories'],
    summary: 'Batch upsert categories',
    description: 'Sync multiple categories at once. Creates or updates by name.',
  };

  upsertKeys = ['name'];
  maxBatchSize = 1000;
  useNativeUpsert = true;
}

class CategoryList extends PrismaListEndpoint {
  _meta = categoryMeta;
  prisma = prisma;

  schema = { tags: ['Categories'], summary: 'List categories' };
  searchFields = ['name'];
  orderByFields = ['name', 'sortOrder'];
  defaultOrderBy = 'sortOrder';
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

// Category endpoints
app.put('/categories', CategoryUpsert);
app.put('/categories/sync', CategoryBatchUpsert);
app.get('/categories', CategoryList);

// Clear data endpoint
app.get('/clear', async (c) => {
  await clearDb();
  return c.json({ success: true, message: 'Data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Upsert Operations Example - Prisma + PostgreSQL',
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

initDb()
  .then(() => {
    console.log(`
=== Upsert Operations Example (Prisma + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, clear any existing data:
  curl http://localhost:${port}/clear

SINGLE UPSERT (Categories by name):

1. Create a new category:
   curl -X PUT http://localhost:${port}/categories \\
     -H "Content-Type: application/json" \\
     -d '{"name": "Technology", "description": "Tech posts", "sortOrder": 1}'

2. Update the same category (same name):
   curl -X PUT http://localhost:${port}/categories \\
     -H "Content-Type: application/json" \\
     -d '{"name": "Technology", "description": "Tech & Software posts", "sortOrder": 1}'

3. List categories (notice same record, updated values):
   curl http://localhost:${port}/categories

BATCH UPSERT (Multiple categories):

4. Initial category sync:
   curl -X PUT http://localhost:${port}/categories/sync \\
     -H "Content-Type: application/json" \\
     -d '[
       {"name": "Science", "description": "Scientific articles", "sortOrder": 2},
       {"name": "Art", "description": "Creative content", "sortOrder": 3},
       {"name": "Music", "description": "Music posts", "sortOrder": 4}
     ]'

5. Incremental sync (updates existing, creates new):
   curl -X PUT http://localhost:${port}/categories/sync \\
     -H "Content-Type: application/json" \\
     -d '[
       {"name": "Science", "description": "Science & Research", "sortOrder": 2},
       {"name": "Sports", "description": "Sports content", "sortOrder": 5}
     ]'

6. List all categories:
   curl http://localhost:${port}/categories

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
