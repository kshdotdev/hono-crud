/**
 * Drizzle table definitions for PostgreSQL.
 *
 * These tables map to the shared Zod schemas defined in ../shared/schemas.ts
 */

import { pgTable, text, integer, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';

// ============================================================================
// Enums
// ============================================================================

export const userRoleEnum = pgEnum('user_role', ['admin', 'user', 'guest']);
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'pending']);
export const postStatusEnum = pgEnum('post_status', ['draft', 'published', 'archived']);

// ============================================================================
// Users Table
// ============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('user'),
  age: integer('age'),
  status: userStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ============================================================================
// Posts Table
// ============================================================================

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: postStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// ============================================================================
// Profiles Table (hasOne from Users)
// ============================================================================

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  bio: text('bio'),
  avatar: text('avatar'),
  website: text('website'),
});

// ============================================================================
// Comments Table (hasMany from Posts, belongsTo Users)
// ============================================================================

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================================
// Categories Table (standalone for filtering tests)
// ============================================================================

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
});
