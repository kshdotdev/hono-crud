import { describe, it, expect } from 'vitest';
import { pgTable, text, integer, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
  createDrizzleSchemas,
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
  it('should return true after drizzle-zod has been loaded', async () => {
    // Force a load first
    await createSelectSchema(users);
    const result = isDrizzleZodAvailable();
    expect(result).toBe(true);
  });

  it('should be consistent on multiple calls', async () => {
    await createSelectSchema(users);
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
  it('should create a Zod schema from a Drizzle table', async () => {
    const schema = await createSelectSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should validate correct data', async () => {
    const schema = await createSelectSchema(users);
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

  it('should reject invalid data', async () => {
    const schema = await createSelectSchema(users);
    const invalidUser = {
      id: 'not-a-uuid',
      name: 123, // Should be string
      email: 'alice@example.com',
    };

    const result = schema.safeParse(invalidUser);
    expect(result.success).toBe(false);
  });

  it('should handle nullable fields', async () => {
    const schema = await createSelectSchema(users);
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

  it('should work with custom refinements', async () => {
    const schema = await createSelectSchema(users, {
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
  it('should create a Zod schema for inserts', async () => {
    const schema = await createInsertSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should make fields with defaults optional', async () => {
    const schema = await createInsertSchema(users);

    // Insert without id (has defaultRandom), createdAt (has defaultNow), isActive (has default)
    const insertData = {
      name: 'Charlie',
      email: 'charlie@example.com',
    };

    const result = schema.safeParse(insertData);
    expect(result.success).toBe(true);
  });

  it('should require non-nullable fields without defaults', async () => {
    const schema = await createInsertSchema(posts);

    // Missing required fields
    const incompleteData = {
      title: 'My Post',
    };

    const result = schema.safeParse(incompleteData);
    expect(result.success).toBe(false);
  });

  it('should validate insert data correctly', async () => {
    const schema = await createInsertSchema(posts);

    const validPost = {
      title: 'My Post',
      content: 'This is the content',
      authorId: crypto.randomUUID(),
    };

    const result = schema.safeParse(validPost);
    expect(result.success).toBe(true);
  });

  it('should work with custom refinements', async () => {
    const schema = await createInsertSchema(users, {
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
  it('should create a Zod schema for updates', async () => {
    const schema = await createUpdateSchema(users);
    expect(schema).toBeDefined();
    expect(typeof schema.parse).toBe('function');
  });

  it('should make all fields optional for updates', async () => {
    const schema = await createUpdateSchema(users);

    // Update with just one field
    const updateData = {
      name: 'Updated Name',
    };

    const result = schema.safeParse(updateData);
    expect(result.success).toBe(true);
  });

  it('should accept empty object for updates', async () => {
    const schema = await createUpdateSchema(users);

    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should still validate field types', async () => {
    const schema = await createUpdateSchema(users);

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
  it('should return all three schemas', async () => {
    const schemas = await createDrizzleSchemas(users);

    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should return schemas with correct behavior', async () => {
    const schemas = await createDrizzleSchemas(users);

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

  it('should accept refinement options', async () => {
    const schemas = await createDrizzleSchemas(users, {
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

  it('should apply insertRefine to insert schema', async () => {
    const schemas = await createDrizzleSchemas(users, {
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

  it('should return a promise', () => {
    const result = createDrizzleSchemas(users);
    expect(result).toBeInstanceOf(Promise);
  });

  it('should accept refinement options (async)', async () => {
    const schemas = await createDrizzleSchemas(users, {
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
  it('should allow type inference from schemas', async () => {
    const schemas = await createDrizzleSchemas(users);

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
  it('should handle tables with only required fields', async () => {
    const simpleTable = pgTable('simple', {
      id: uuid('id').primaryKey(),
      value: text('value').notNull(),
    });

    const schemas = await createDrizzleSchemas(simpleTable);
    expect(schemas.select).toBeDefined();
    expect(schemas.insert).toBeDefined();
    expect(schemas.update).toBeDefined();
  });

  it('should handle tables with all optional fields', async () => {
    const optionalTable = pgTable('optional', {
      id: uuid('id').primaryKey().defaultRandom(),
      a: text('a'),
      b: integer('b'),
      c: boolean('c').default(false),
    });

    const schemas = await createDrizzleSchemas(optionalTable);

    // All fields should be optional for insert
    const result = schemas.insert.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should handle multiple tables independently', async () => {
    const userSchemas = await createDrizzleSchemas(users);
    const postSchemas = await createDrizzleSchemas(posts);

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
