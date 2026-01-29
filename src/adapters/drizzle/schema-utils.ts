/**
 * Drizzle-Zod schema utilities.
 *
 * This module provides helpers for generating Zod schemas from Drizzle tables
 * using drizzle-zod. This allows automatic schema generation for CRUD operations.
 *
 * Note: drizzle-zod is an optional peer dependency. These utilities will only
 * work if drizzle-zod is installed.
 *
 * @example
 * ```ts
 * import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
 * import { createDrizzleSchemas } from 'hono-crud/adapters/drizzle';
 *
 * const users = pgTable('users', {
 *   id: uuid('id').primaryKey().defaultRandom(),
 *   name: text('name').notNull(),
 *   email: text('email').notNull().unique(),
 *   createdAt: timestamp('created_at').defaultNow(),
 * });
 *
 * const { select: UserSchema, insert: CreateUserSchema } = createDrizzleSchemas(users);
 * ```
 */

import type { Table } from 'drizzle-orm';
import type { z } from 'zod';

// Type definitions for drizzle-zod functions
// These allow the module to compile even without drizzle-zod installed
type CreateSelectSchema = <T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
) => z.ZodObject<Record<string, z.ZodTypeAny>>;

type CreateInsertSchema = <T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
) => z.ZodObject<Record<string, z.ZodTypeAny>>;

type CreateUpdateSchema = <T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
) => z.ZodObject<Record<string, z.ZodTypeAny>>;

// Cached drizzle-zod module
let _drizzleZod: {
  createSelectSchema: CreateSelectSchema;
  createInsertSchema: CreateInsertSchema;
  createUpdateSchema?: CreateUpdateSchema;
} | null = null;
let _loadAttempted = false;
let _loadError: Error | null = null;

/**
 * Tries to load drizzle-zod synchronously.
 * Returns the module if available, null otherwise.
 */
function tryLoadDrizzleZod(): typeof _drizzleZod {
  if (_loadAttempted) {
    if (_loadError) throw _loadError;
    return _drizzleZod;
  }

  _loadAttempted = true;

  try {
    // Try dynamic require for synchronous loading
    // This works in Node.js environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _drizzleZod = require('drizzle-zod');
    return _drizzleZod;
  } catch {
    _loadError = new Error(
      'drizzle-zod is not installed. Please install it: npm install drizzle-zod'
    );
    throw _loadError;
  }
}

/**
 * Async version that uses dynamic import.
 */
async function loadDrizzleZodAsync(): Promise<typeof _drizzleZod> {
  if (_loadAttempted) {
    if (_loadError) throw _loadError;
    return _drizzleZod;
  }

  _loadAttempted = true;

  try {
    _drizzleZod = await import('drizzle-zod');
    return _drizzleZod;
  } catch {
    _loadError = new Error(
      'drizzle-zod is not installed. Please install it: npm install drizzle-zod'
    );
    throw _loadError;
  }
}

/**
 * Re-export createSelectSchema from drizzle-zod.
 * Creates a Zod schema for SELECT queries (all columns as required/optional based on table definition).
 *
 * @param table - Drizzle table definition
 * @param refine - Optional refinements for specific columns
 * @returns Zod schema for the table's select type
 *
 * @example
 * ```ts
 * import { users } from './schema';
 * import { createSelectSchema } from 'hono-crud/adapters/drizzle';
 *
 * const UserSchema = createSelectSchema(users);
 * type User = z.infer<typeof UserSchema>;
 * ```
 */
export function createSelectSchema<T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const drizzleZod = tryLoadDrizzleZod();
  return drizzleZod!.createSelectSchema(table, refine);
}

/**
 * Re-export createInsertSchema from drizzle-zod.
 * Creates a Zod schema for INSERT queries (columns with defaults become optional).
 *
 * @param table - Drizzle table definition
 * @param refine - Optional refinements for specific columns
 * @returns Zod schema for the table's insert type
 *
 * @example
 * ```ts
 * import { users } from './schema';
 * import { createInsertSchema } from 'hono-crud/adapters/drizzle';
 *
 * const CreateUserSchema = createInsertSchema(users);
 * type CreateUser = z.infer<typeof CreateUserSchema>;
 * ```
 */
export function createInsertSchema<T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const drizzleZod = tryLoadDrizzleZod();
  return drizzleZod!.createInsertSchema(table, refine);
}

/**
 * Re-export createUpdateSchema from drizzle-zod (if available).
 * Creates a Zod schema for UPDATE queries (all columns become optional).
 *
 * Note: createUpdateSchema may not be available in older versions of drizzle-zod.
 * Use createInsertSchema(table).partial() as an alternative.
 *
 * @param table - Drizzle table definition
 * @param refine - Optional refinements for specific columns
 * @returns Zod schema for the table's update type
 *
 * @example
 * ```ts
 * import { users } from './schema';
 * import { createUpdateSchema } from 'hono-crud/adapters/drizzle';
 *
 * const UpdateUserSchema = createUpdateSchema(users);
 * type UpdateUser = z.infer<typeof UpdateUserSchema>;
 * ```
 */
export function createUpdateSchema<T extends Table>(
  table: T,
  refine?: Record<string, z.ZodTypeAny>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const drizzleZod = tryLoadDrizzleZod();

  if (drizzleZod!.createUpdateSchema) {
    return drizzleZod!.createUpdateSchema(table, refine);
  }

  // Fallback: use insert schema with all fields optional
  const insertSchema = drizzleZod!.createInsertSchema(table, refine);
  return insertSchema.partial() as z.ZodObject<Record<string, z.ZodTypeAny>>;
}

/**
 * Result of createDrizzleSchemas helper.
 */
export interface DrizzleSchemas {
  /** Schema for SELECT queries (full record) */
  select: z.ZodObject<Record<string, z.ZodTypeAny>>;
  /** Schema for INSERT queries (required fields only) */
  insert: z.ZodObject<Record<string, z.ZodTypeAny>>;
  /** Schema for UPDATE queries (all fields optional) */
  update: z.ZodObject<Record<string, z.ZodTypeAny>>;
}

/**
 * Creates all three common schemas (select, insert, update) for a Drizzle table.
 *
 * This is a convenience helper that generates:
 * - `select`: Full record schema for reading data
 * - `insert`: Schema for creating new records
 * - `update`: Partial schema for updating records
 *
 * @param table - Drizzle table definition
 * @param options - Optional configuration
 * @param options.insertRefine - Refinements for insert schema
 * @param options.selectRefine - Refinements for select schema
 * @param options.updateRefine - Refinements for update schema
 * @returns Object containing select, insert, and update schemas
 *
 * @example
 * ```ts
 * import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
 * import { createDrizzleSchemas, defineModel, defineMeta } from 'hono-crud/adapters/drizzle';
 * import { z } from 'zod';
 *
 * const users = pgTable('users', {
 *   id: uuid('id').primaryKey().defaultRandom(),
 *   name: text('name').notNull(),
 *   email: text('email').notNull().unique(),
 * });
 *
 * // Generate schemas from table
 * const schemas = createDrizzleSchemas(users, {
 *   insertRefine: {
 *     email: z.string().email(), // Add email validation
 *   },
 * });
 *
 * // Use with hono-crud model
 * const UserModel = defineModel({
 *   tableName: 'users',
 *   schema: schemas.select,
 *   primaryKeys: ['id'],
 *   table: users,
 * });
 * ```
 */
export function createDrizzleSchemas<T extends Table>(
  table: T,
  options?: {
    insertRefine?: Record<string, z.ZodTypeAny>;
    selectRefine?: Record<string, z.ZodTypeAny>;
    updateRefine?: Record<string, z.ZodTypeAny>;
  }
): DrizzleSchemas {
  const drizzleZod = tryLoadDrizzleZod();

  const select = drizzleZod!.createSelectSchema(table, options?.selectRefine);
  const insert = drizzleZod!.createInsertSchema(table, options?.insertRefine);

  let update: z.ZodObject<Record<string, z.ZodTypeAny>>;
  if (drizzleZod!.createUpdateSchema) {
    update = drizzleZod!.createUpdateSchema(table, options?.updateRefine);
  } else {
    // Fallback for older drizzle-zod versions
    update = drizzleZod!.createInsertSchema(table, options?.updateRefine).partial() as z.ZodObject<Record<string, z.ZodTypeAny>>;
  }

  return { select, insert, update };
}

/**
 * Async version of createDrizzleSchemas that handles lazy loading.
 * Use this if you're not sure drizzle-zod is already loaded.
 *
 * @param table - Drizzle table definition
 * @param options - Optional configuration
 * @returns Promise resolving to schemas object
 */
export async function createDrizzleSchemasAsync<T extends Table>(
  table: T,
  options?: {
    insertRefine?: Record<string, z.ZodTypeAny>;
    selectRefine?: Record<string, z.ZodTypeAny>;
    updateRefine?: Record<string, z.ZodTypeAny>;
  }
): Promise<DrizzleSchemas> {
  await loadDrizzleZodAsync();
  return createDrizzleSchemas(table, options);
}

/**
 * Checks if drizzle-zod is available.
 * @returns true if drizzle-zod can be imported
 */
export function isDrizzleZodAvailable(): boolean {
  try {
    tryLoadDrizzleZod();
    return true;
  } catch {
    return false;
  }
}
