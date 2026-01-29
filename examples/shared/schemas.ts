/**
 * Shared Zod schemas for all adapter examples.
 *
 * These schemas define the data models used across Memory, Drizzle, and Prisma adapters.
 * Each adapter will have its own database-specific schema definitions that map to these Zod schemas.
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const UserRole = z.enum(['admin', 'user', 'guest']);
export type UserRole = z.infer<typeof UserRole>;

export const UserStatus = z.enum(['active', 'inactive', 'pending']);
export type UserStatus = z.infer<typeof UserStatus>;

export const PostStatus = z.enum(['draft', 'published', 'archived']);
export type PostStatus = z.infer<typeof PostStatus>;

// ============================================================================
// User Schema
// ============================================================================

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: UserRole.default('user'),
  age: z.number().int().positive().optional().nullable(),
  status: UserStatus.default('active'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  deletedAt: z.date().nullable().optional(),
});

export type User = z.infer<typeof UserSchema>;

// Schema for creating users (id, timestamps are optional/auto-generated)
export const UserCreateSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
}).extend({
  id: z.uuid().optional(),
});

export type UserCreate = z.infer<typeof UserCreateSchema>;

// Schema for updating users (all fields optional)
export const UserUpdateSchema = UserSchema.partial().omit({
  id: true,
  createdAt: true,
});

export type UserUpdate = z.infer<typeof UserUpdateSchema>;

// ============================================================================
// Post Schema
// ============================================================================

export const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  content: z.string(),
  authorId: z.uuid(),
  status: PostStatus.default('draft'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  deletedAt: z.date().nullable().optional(),
});

export type Post = z.infer<typeof PostSchema>;

export const PostCreateSchema = PostSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
}).extend({
  id: z.uuid().optional(),
});

export type PostCreate = z.infer<typeof PostCreateSchema>;

// ============================================================================
// Profile Schema (hasOne from Users)
// ============================================================================

export const ProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  bio: z.string().optional().nullable(),
  avatar: z.url().optional().nullable(),
  website: z.url().optional().nullable(),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileCreateSchema = ProfileSchema.omit({
  id: true,
}).extend({
  id: z.uuid().optional(),
});

export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;

// ============================================================================
// Comment Schema (hasMany from Posts, belongsTo Users)
// ============================================================================

export const CommentSchema = z.object({
  id: z.uuid(),
  content: z.string().min(1),
  postId: z.uuid(),
  authorId: z.uuid(),
  createdAt: z.date().optional(),
});

export type Comment = z.infer<typeof CommentSchema>;

export const CommentCreateSchema = CommentSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  id: z.uuid().optional(),
});

export type CommentCreate = z.infer<typeof CommentCreateSchema>;

// ============================================================================
// Category Schema (standalone for filtering tests)
// ============================================================================

export const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
});

export type Category = z.infer<typeof CategorySchema>;

export const CategoryCreateSchema = CategorySchema.omit({
  id: true,
}).extend({
  id: z.uuid().optional(),
});

export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
