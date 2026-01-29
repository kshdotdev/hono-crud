import { describe, it, expect } from 'vitest';
import { pgTable, text, integer, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
  createDrizzleSchemas,
  createDrizzleSchemasAsync,
  isDrizzleZodAvailable,
} from '../src/adapters/drizzle/schema-utils.js';

// ============================================================================
// Test Table Definitions
// ============================================================================

const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  age: integer('age'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').notNull(),
  publishedAt: timestamp('published_at'),
});

// ============================================================================
// isDrizzleZodAvailable() Tests
// ============================================================================

describe('isDrizzleZodAvailable', () => {
  it('should return true when drizzle-zod is installed', () => {
    const result = isDrizzleZodAvailable();
    expect(result).toBe(true);
  });

  it('should be consistent on multiple calls', () => {
    const result1 = isDrizzleZodAvailable();
    const result2 = isDrizzleZodAvailable();
    const result3 = isDrizzleZodAvailable();
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });
});

// ============================================================================
// createSelectSchema() Tests
// ============================================================================

describe('createSelectSchema', () => {
  it('should create a Zod schema from a Drizzle table', () => {
    const schema = createSelectSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should validate correct data', () => {
    const schema = createSelectSchema(users);
    const validUser = {
      id: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    };

    const result = schema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it('should reject invalid data', () => {
    const schema = createSelectSchema(users);
    const invalidUser = {
      id: 'not-a-uuid',
      name: 123, // Should be string
      email: 'alice@example.com',
    };

    const result = schema.safeParse(invalidUser);
    expect(result.success).toBe(false);
  });

  it('should handle nullable fields', () => {
    const schema = createSelectSchema(users);
    const userWithNulls = {
      id: crypto.randomUUID(),
      name: 'Bob',
      email: 'bob@example.com',
      age: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    };

    const result = schema.safeParse(userWithNulls);
    expect(result.success).toBe(true);
  });

  it('should work with custom refinements', () => {
    const schema = createSelectSchema(users, {
      email: z.string().email().endsWith('@company.com'),
    });

    const companyUser = {
      id: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@company.com',
      age: 30,
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    };

    const result = schema.safeParse(companyUser);
    expect(result.success).toBe(true);

    const nonCompanyUser = {
      ...companyUser,
      email: 'alice@gmail.com',
    };

    const result2 = schema.safeParse(nonCompanyUser);
    expect(result2.success).toBe(false);
  });
});

// ============================================================================
// createInsertSchema() Tests
// ============================================================================

describe('createInsertSchema', () => {
  it('should create a Zod schema for inserts', () => {
    const schema = createInsertSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should make fields with defaults optional', () => {
    const schema = createInsertSchema(users);

    // Insert without id (has defaultRandom), createdAt (has defaultNow), isActive (has default)
    const insertData = {
      name: 'Charlie',
      email: 'charlie@example.com',
    };

    const result = schema.safeParse(insertData);
    expect(result.success).toBe(true);
  });

  it('should require non-nullable fields without defaults', () => {
    const schema = createInsertSchema(posts);

    // Missing required fields
    const incompleteData = {
      title: 'My Post',
    };

    const result = schema.safeParse(incompleteData);
    expect(result.success).toBe(false);
  });

  it('should validate insert data correctly', () => {
    const schema = createInsertSchema(posts);

    const validPost = {
      title: 'My Post',
      content: 'This is the content',
      authorId: crypto.randomUUID(),
    };

    const result = schema.safeParse(validPost);
    expect(result.success).toBe(true);
  });

  it('should work with custom refinements', () => {
    const schema = createInsertSchema(users, {
      name: z.string().min(2).max(50),
      age: z.number().min(0).max(150).optional(),
    });

    const validUser = {
      name: 'Al', // Minimum 2 chars
      email: 'al@example.com',
      age: 25,
    };

    const result = schema.safeParse(validUser);
    expect(result.success).toBe(true);

    const invalidUser = {
      name: 'A', // Too short
      email: 'a@example.com',
    };

    const result2 = schema.safeParse(invalidUser);
    expect(result2.success).toBe(false);
  });
});

// ============================================================================
// createUpdateSchema() Tests
// ============================================================================

describe('createUpdateSchema', () => {
  it('should create a Zod schema for updates', () => {
    const schema = createUpdateSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should make all fields optional for updates', () => {
    const schema = createUpdateSchema(users);

    // Update with just one field
    const updateData = {
      name: 'Updated Name',
    };

    const result = schema.safeParse(updateData);
    expect(result.success).toBe(true);
  });

  it('should accept empty object for updates', () => {
    const schema = createUpdateSchema(users);

    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should still validate field types', () => {
    const schema = createUpdateSchema(users);

    const invalidUpdate = {
      age: 'not a number',
    };

    const result = schema.safeParse(invalidUpdate);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// createDrizzleSchemas() Tests
// ============================================================================

describe('createDrizzleSchemas', () => {
  it('should return all three schemas', () => {
    const schemas = createDrizzleSchemas(users);

    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should return schemas with correct behavior', () => {
    const schemas = createDrizzleSchemas(users);

    // Select schema requires all fields
    const selectResult = schemas.select.safeParse({
      id: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    });
    expect(selectResult.success).toBe(true);

    // Insert schema makes defaults optional
    const insertResult = schemas.insert.safeParse({
      name: 'Bob',
      email: 'bob@example.com',
    });
    expect(insertResult.success).toBe(true);

    // Update schema makes everything optional
    const updateResult = schemas.update.safeParse({
      name: 'Updated',
    });
    expect(updateResult.success).toBe(true);
  });

  it('should accept refinement options', () => {
    const schemas = createDrizzleSchemas(users, {
      insertRefine: {
        email: z.string().email(),
      },
      selectRefine: {
        name: z.string().min(1),
      },
    });

    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should apply insertRefine to insert schema', () => {
    const schemas = createDrizzleSchemas(users, {
      insertRefine: {
        name: z.string().min(5, 'Name must be at least 5 characters'),
      },
    });

    const shortName = {
      name: 'Bob',
      email: 'bob@example.com',
    };

    const result = schemas.insert.safeParse(shortName);
    expect(result.success).toBe(false);

    const longName = {
      name: 'Robert',
      email: 'robert@example.com',
    };

    const result2 = schemas.insert.safeParse(longName);
    expect(result2.success).toBe(true);
  });
});

// ============================================================================
// createDrizzleSchemasAsync() Tests
// ============================================================================

describe('createDrizzleSchemasAsync', () => {
  it('should return a promise', () => {
    const result = createDrizzleSchemasAsync(users);
    expect(result).toBeInstanceOf(Promise);
  });

  it('should resolve to schemas object', async () => {
    const schemas = await createDrizzleSchemasAsync(users);

    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should work the same as sync version', async () => {
    const asyncSchemas = await createDrizzleSchemasAsync(users);
    const syncSchemas = createDrizzleSchemas(users);

    const testData = {
      name: 'Test',
      email: 'test@example.com',
    };

    const asyncResult = asyncSchemas.insert.safeParse(testData);
    const syncResult = syncSchemas.insert.safeParse(testData);

    expect(asyncResult.success).toBe(syncResult.success);
  });

  it('should accept refinement options', async () => {
    const schemas = await createDrizzleSchemasAsync(users, {
      insertRefine: {
        age: z.number().positive().optional(),
      },
    });

    expect(schemas.insert).toBeDefined();
  });
});

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('Type inference', () => {
  it('should allow type inference from schemas', () => {
    const schemas = createDrizzleSchemas(users);

    // These would fail TypeScript compilation if types weren't correct
    type SelectUser = z.infer<typeof schemas.select>;
    type InsertUser = z.infer<typeof schemas.insert>;
    type UpdateUser = z.infer<typeof schemas.update>;

    // Runtime check that types are usable
    const user: SelectUser = {
      id: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    };

    expect(user.name).toBe('Alice');
  });
});

// ============================================================================
// Export Tests
// ============================================================================

describe('Drizzle adapter exports', () => {
  it('should export schema utilities from adapter index', async () => {
    const exports = await import('../src/adapters/drizzle/index.js');

    expect(exports.createSelectSchema).toBeDefined();
    expect(exports.createInsertSchema).toBeDefined();
    expect(exports.createUpdateSchema).toBeDefined();
    expect(exports.createDrizzleSchemas).toBeDefined();
    expect(exports.createDrizzleSchemasAsync).toBeDefined();
    expect(exports.isDrizzleZodAvailable).toBeDefined();
  });

  it('should export DrizzleSchemas type', async () => {
    // This is a compile-time check
    const schemaType: import('../src/adapters/drizzle/schema-utils.js').DrizzleSchemas | null =
      null;
    expect(schemaType).toBeNull();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  it('should handle tables with only required fields', () => {
    const simpleTable = pgTable('simple', {
      id: uuid('id').primaryKey(),
      value: text('value').notNull(),
    });

    const schemas = createDrizzleSchemas(simpleTable);
    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should handle tables with all optional fields', () => {
    const optionalTable = pgTable('optional', {
      id: uuid('id').primaryKey().defaultRandom(),
      a: text('a'),
      b: integer('b'),
      c: boolean('c').default(false),
    });

    const schemas = createDrizzleSchemas(optionalTable);

    // All fields should be optional for insert
    const result = schemas.insert.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should handle multiple tables independently', () => {
    const userSchemas = createDrizzleSchemas(users);
    const postSchemas = createDrizzleSchemas(posts);

    // Schemas should be independent
    expect(userSchemas.select).not.toBe(postSchemas.select);

    // Each should validate its own structure
    const userResult = userSchemas.insert.safeParse({
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(userResult.success).toBe(true);

    const postResult = postSchemas.insert.safeParse({
      title: 'Post',
      content: 'Content',
      authorId: crypto.randomUUID(),
    });
    expect(postResult.success).toBe(true);
  });
});
