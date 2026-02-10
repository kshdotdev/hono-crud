/**
 * Example: Using drizzle-zod to Auto-Generate Schemas
 *
 * This example demonstrates how to use drizzle-zod to automatically
 * generate Zod schemas from your Drizzle table definitions.
 *
 * Benefits:
 * - Single source of truth for your database schema
 * - Automatic type inference
 * - No need to manually define Zod schemas
 * - Schema stays in sync with database changes
 *
 * Prerequisites:
 *   npm install drizzle-zod
 *
 * Run with: npx tsx examples/drizzle/with-drizzle-zod.ts
 */

import { Hono, type Env } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import {
  fromHono,
  registerCrud,
  setupSwaggerUI,
  setupScalar,
  defineModel,
  defineMeta,
  // OpenAPI utilities
  jsonContent,
  createErrorSchema,
  openApiValidationHook,
} from '../../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  DrizzleDatabase,
  // drizzle-zod helpers
  createDrizzleSchemas,
} from '../../src/adapters/drizzle/index.js';

// ============================================================================
// Database Setup
// ============================================================================

const client = createClient({
  url: 'file:./examples/drizzle/with-drizzle-zod.db',
});
const db = drizzle(client);

// ============================================================================
// Drizzle Table Definition (Single Source of Truth)
// ============================================================================

/**
 * Define your table schema in Drizzle.
 * This is the single source of truth for your data model.
 */
const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull(), // Price in cents
  category: text('category').notNull(),
  inStock: integer('in_stock', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

// ============================================================================
// Auto-Generated Schemas from Drizzle Table
// ============================================================================

// ============================================================================
// Initialize Database and Start Server
// ============================================================================

async function initDatabase() {
  // Create products table if it doesn't exist
  await client.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      category TEXT NOT NULL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  console.log('Database initialized');
}

async function main() {
  await initDatabase();

  /**
   * Use createDrizzleSchemas to automatically generate Zod schemas
   * from your Drizzle table definition.
   *
   * This generates:
   * - select: Schema for reading (all columns)
   * - insert: Schema for creating (required columns, defaults optional)
   * - update: Schema for updating (all columns optional)
   */
  const productSchemas = await createDrizzleSchemas(products, {
    // Add custom validation rules
    insertRefine: {
      name: z.string().min(1).max(100),
      price: z.number().int().min(0), // Price must be non-negative
      category: z.enum(['electronics', 'clothing', 'food', 'other']),
    },
  });

  // Type inference works automatically
  type Product = z.infer<typeof productSchemas.select>;
  type CreateProduct = z.infer<typeof productSchemas.insert>;

  // ============================================================================
  // Model Definition
  // ============================================================================

  const ProductModel = defineModel({
    tableName: 'products',
    schema: productSchemas.select,
    primaryKeys: ['id'],
    table: products, // Reference to Drizzle table for the adapter
  });

  const productMeta = defineMeta({
    model: ProductModel,
  });

  // ============================================================================
  // Endpoint Classes
  // ============================================================================

  class ProductCreate extends DrizzleCreateEndpoint<Env, typeof productMeta> {
    _meta = productMeta;
    db: DrizzleDatabase = db as unknown as DrizzleDatabase;

    schema = {
      tags: ['Products'],
      summary: 'Create a new product',
    };

    async before(data: Partial<Product>) {
      return {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Product;
    }
  }

  class ProductList extends DrizzleListEndpoint<Env, typeof productMeta> {
    _meta = productMeta;
    db: DrizzleDatabase = db as unknown as DrizzleDatabase;

    schema = {
      tags: ['Products'],
      summary: 'List all products',
    };

    filterFields = ['category', 'inStock'];
    searchFields = ['name', 'description'];
    orderByFields = ['name', 'price', 'createdAt'];
    defaultOrderBy = 'createdAt';
    defaultOrderDirection: 'asc' | 'desc' = 'desc';
  }

  class ProductRead extends DrizzleReadEndpoint<Env, typeof productMeta> {
    _meta = productMeta;
    db: DrizzleDatabase = db as unknown as DrizzleDatabase;

    schema = {
      tags: ['Products'],
      summary: 'Get a product by ID',
    };
  }

  class ProductUpdate extends DrizzleUpdateEndpoint<Env, typeof productMeta> {
    _meta = productMeta;
    db: DrizzleDatabase = db as unknown as DrizzleDatabase;

    schema = {
      tags: ['Products'],
      summary: 'Update a product',
    };

    allowedUpdateFields = ['name', 'description', 'price', 'category', 'inStock'];

    async before(data: Partial<Product>) {
      return {
        ...data,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  class ProductDelete extends DrizzleDeleteEndpoint<Env, typeof productMeta> {
    _meta = productMeta;
    db: DrizzleDatabase = db as unknown as DrizzleDatabase;

    schema = {
      tags: ['Products'],
      summary: 'Delete a product',
    };
  }

  // ============================================================================
  // App Setup
  // ============================================================================

  const app = fromHono(new Hono());

  // Register CRUD endpoints
  registerCrud(app, '/products', {
    create: ProductCreate,
    list: ProductList,
    read: ProductRead,
    update: ProductUpdate,
    delete: ProductDelete,
  });

  // OpenAPI documentation
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'drizzle-zod Example API',
      version: '1.0.0',
      description: 'Demonstrates auto-generating Zod schemas from Drizzle tables using drizzle-zod',
    },
  });

  // Setup both Swagger UI and Scalar API Reference
  setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
  setupScalar(app, '/reference', {
    specUrl: '/openapi.json',
    theme: 'purple',
    pageTitle: 'drizzle-zod Example API',
  });

  // Health check
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      adapter: 'drizzle',
      features: ['drizzle-zod', 'scalar-ui'],
    })
  );

  const port = Number(process.env.PORT) || 3456;

  console.log(`
=== drizzle-zod Example ===

This example demonstrates:
- Auto-generating Zod schemas from Drizzle tables using drizzle-zod
- Using the new Scalar API Reference UI
- OpenAPI utilities (jsonContent, createErrorSchema, etc.)

Server running at http://localhost:${port}

Documentation:
  Swagger UI:     http://localhost:${port}/docs
  Scalar UI:      http://localhost:${port}/reference  (try this!)
  OpenAPI JSON:   http://localhost:${port}/openapi.json

Available endpoints:
  POST   /products          - Create a product
  GET    /products          - List products
  GET    /products/:id      - Get a product by ID
  PATCH  /products/:id      - Update a product
  DELETE /products/:id      - Delete a product

Try:
  curl -X POST http://localhost:${port}/products \\
    -H "Content-Type: application/json" \\
    -d '{"name":"Laptop","description":"A great laptop","price":99900,"category":"electronics"}'
`);

  serve({
    fetch: app.fetch,
    port,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
