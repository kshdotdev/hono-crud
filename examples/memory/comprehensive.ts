/**
 * Comprehensive Example: All Features with Memory Adapter
 *
 * This example demonstrates ALL hono-crud features in a single application:
 * - Basic CRUD operations
 * - Advanced filtering (all operators)
 * - Soft delete & restore
 * - Batch operations (create, update, delete, restore)
 * - Upsert operations
 * - Relations (?include=)
 * - Pagination & sorting
 * - Search functionality
 *
 * Run with: npx tsx examples/memory/comprehensive.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { fromHono, registerCrud, setupSwaggerUI, setupReDoc, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryUpdateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryRestoreEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryUpsertEndpoint,
  clearStorage,
  getStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage on start
clearStorage();

// ============================================================================
// Schemas
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
  age: z.number().int().positive().optional().nullable(),
  status: z.enum(['active', 'inactive', 'pending']).default('active'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(),
});

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  content: z.string(),
  authorId: z.uuid(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  createdAt: z.string().datetime().optional(),
  deletedAt: z.date().nullable().optional(),
});

const ProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  bio: z.string().optional().nullable(),
  avatar: z.url().optional().nullable(),
  website: z.url().optional().nullable(),
});

const CommentSchema = z.object({
  id: z.uuid(),
  content: z.string().min(1),
  postId: z.uuid(),
  authorId: z.uuid(),
  createdAt: z.string().datetime().optional(),
});

const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
});

type User = z.infer<typeof UserSchema>;
type Post = z.infer<typeof PostSchema>;
type Profile = z.infer<typeof ProfileSchema>;
type Comment = z.infer<typeof CommentSchema>;
type Category = z.infer<typeof CategorySchema>;

// ============================================================================
// Models with Full Configuration
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  softDelete: true,
  relations: {
    posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' },
    profile: { type: 'hasOne', model: 'profiles', foreignKey: 'userId' },
    comments: { type: 'hasMany', model: 'comments', foreignKey: 'authorId' },
  },
});

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  softDelete: true,
  relations: {
    author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'id' },
    comments: { type: 'hasMany', model: 'comments', foreignKey: 'postId' },
  },
});

const ProfileModel = defineModel({
  tableName: 'profiles',
  schema: ProfileSchema,
  primaryKeys: ['id'],
  relations: {
    user: { type: 'belongsTo', model: 'users', foreignKey: 'userId', localKey: 'id' },
  },
});

const CommentModel = defineModel({
  tableName: 'comments',
  schema: CommentSchema,
  primaryKeys: ['id'],
  relations: {
    post: { type: 'belongsTo', model: 'posts', foreignKey: 'postId', localKey: 'id' },
    author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'id' },
  },
});

const CategoryModel = defineModel({
  tableName: 'categories',
  schema: CategorySchema,
  primaryKeys: ['id'],
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const profileMeta = defineMeta({ model: ProfileModel });
const commentMeta = defineMeta({ model: CommentModel });
const categoryMeta = defineMeta({ model: CategoryModel });

// ============================================================================
// User Endpoints (Full CRUD + Batch + Relations)
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a user' };

  async before(data: Partial<User>) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
  }
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;

  schema = {
    tags: ['Users'],
    summary: 'List users',
    description: 'Full filtering, searching, sorting, pagination, and relation loading.',
  };

  filterFields = ['role', 'status'];
  filterConfig = {
    age: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'null'] as const,
    name: ['eq', 'like', 'ilike'] as const,
    email: ['eq', 'like', 'ilike'] as const,
  };

  searchFields = ['name', 'email'];
  sortFields = ['name', 'age', 'createdAt'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };

  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Get a user by ID' };
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'age', 'status'];

  async before(data: Partial<User>) {
    return { ...data, updatedAt: new Date().toISOString() };
  }
}

class UserDelete extends MemoryDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Delete a user (soft delete)' };
}

class UserRestore extends MemoryRestoreEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

class UserBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users - Batch'], summary: 'Batch create users' };
  maxBatchSize = 100;

  async before(data: Partial<User>, index: number) {
    return {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
  }
}

class UserBatchUpdate extends MemoryBatchUpdateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users - Batch'], summary: 'Batch update users' };
  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users - Batch'], summary: 'Batch delete users' };
  maxBatchSize = 100;
}

class UserBatchRestore extends MemoryBatchRestoreEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users - Batch'], summary: 'Batch restore users' };
  maxBatchSize = 100;
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends MemoryCreateEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Create a post' };

  async before(data: Partial<Post>) {
    return { ...data, createdAt: new Date().toISOString(), deletedAt: null };
  }
}

class PostList extends MemoryListEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'List posts' };
  filterFields = ['status'];
  searchFields = ['title', 'content'];
  sortFields = ['title', 'createdAt'];
  allowedIncludes = ['author', 'comments'];
}

class PostRead extends MemoryReadEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Get a post by ID' };
  allowedIncludes = ['author', 'comments'];
}

class PostUpdate extends MemoryUpdateEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Update a post' };
  allowedUpdateFields = ['title', 'content', 'status'];
}

class PostDelete extends MemoryDeleteEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Delete a post (soft delete)' };
}

class PostRestore extends MemoryRestoreEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Restore a deleted post' };
}

// ============================================================================
// Profile Endpoints
// ============================================================================

class ProfileCreate extends MemoryCreateEndpoint {
  _meta = profileMeta;
  schema = { tags: ['Profiles'], summary: 'Create a profile' };
}

class ProfileRead extends MemoryReadEndpoint {
  _meta = profileMeta;
  schema = { tags: ['Profiles'], summary: 'Get a profile by ID' };
  allowedIncludes = ['user'];
}

class ProfileUpdate extends MemoryUpdateEndpoint {
  _meta = profileMeta;
  schema = { tags: ['Profiles'], summary: 'Update a profile' };
  allowedUpdateFields = ['bio', 'avatar', 'website'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends MemoryCreateEndpoint {
  _meta = commentMeta;
  schema = { tags: ['Comments'], summary: 'Create a comment' };

  async before(data: Partial<Comment>) {
    return { ...data, createdAt: new Date().toISOString() };
  }
}

class CommentList extends MemoryListEndpoint {
  _meta = commentMeta;
  schema = { tags: ['Comments'], summary: 'List comments' };
  allowedIncludes = ['post', 'author'];
}

class CommentRead extends MemoryReadEndpoint {
  _meta = commentMeta;
  schema = { tags: ['Comments'], summary: 'Get a comment by ID' };
  allowedIncludes = ['post', 'author'];
}

// ============================================================================
// Category Endpoints (Upsert)
// ============================================================================

class CategoryCreate extends MemoryCreateEndpoint {
  _meta = categoryMeta;
  schema = { tags: ['Categories'], summary: 'Create a category' };
}

class CategoryList extends MemoryListEndpoint {
  _meta = categoryMeta;
  schema = { tags: ['Categories'], summary: 'List categories' };
  filterFields = ['name'];
  filterConfig = {
    sortOrder: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
  };
  sortFields = ['name', 'sortOrder'];
  defaultSort = { field: 'sortOrder', order: 'asc' as const };
}

class CategoryUpsert extends MemoryUpsertEndpoint {
  _meta = categoryMeta;
  schema = {
    tags: ['Categories'],
    summary: 'Upsert a category',
    description: 'Creates or updates a category by name.',
  };
  upsertKeys = ['name'];
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

// Users (full CRUD + batch)
registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
  update: UserUpdate,
  delete: UserDelete,
  restore: UserRestore,
  batchCreate: UserBatchCreate,
  batchUpdate: UserBatchUpdate,
  batchDelete: UserBatchDelete,
  batchRestore: UserBatchRestore,
});

// Posts
registerCrud(app, '/posts', {
  create: PostCreate,
  list: PostList,
  read: PostRead,
  update: PostUpdate,
  delete: PostDelete,
  restore: PostRestore,
});

// Profiles
registerCrud(app, '/profiles', {
  create: ProfileCreate,
  read: ProfileRead,
  update: ProfileUpdate,
});

// Comments
registerCrud(app, '/comments', {
  create: CommentCreate,
  list: CommentList,
  read: CommentRead,
});

// Categories (with upsert)
registerCrud(app, '/categories', {
  create: CategoryCreate,
  list: CategoryList,
});
app.put('/categories', CategoryUpsert);

// Seed endpoint
app.get('/seed', async (c) => {
  clearStorage();

  const userStore = getStorage<User>('users');
  const profileStore = getStorage<Profile>('profiles');
  const postStore = getStorage<Post>('posts');
  const commentStore = getStorage<Comment>('comments');
  const categoryStore = getStorage<Category>('categories');

  // Seed users
  const users: User[] = [
    { id: 'a0000000-0000-0000-0000-000000000001', email: 'alice@example.com', name: 'Alice Admin', role: 'admin', age: 35, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null },
    { id: 'a0000000-0000-0000-0000-000000000002', email: 'bob@example.com', name: 'Bob User', role: 'user', age: 28, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null },
    { id: 'a0000000-0000-0000-0000-000000000003', email: 'charlie@example.com', name: 'Charlie Guest', role: 'guest', age: 22, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null },
  ];
  users.forEach(u => userStore.set(u.id, u));

  // Seed profiles
  const profiles: Profile[] = [
    { id: 'b0000000-0000-0000-0000-000000000001', userId: 'a0000000-0000-0000-0000-000000000001', bio: 'Alice is a developer', avatar: 'https://example.com/alice.jpg', website: null },
    { id: 'b0000000-0000-0000-0000-000000000002', userId: 'a0000000-0000-0000-0000-000000000002', bio: 'Bob is a designer', avatar: null, website: null },
  ];
  profiles.forEach(p => profileStore.set(p.id, p));

  // Seed posts
  const posts: Post[] = [
    { id: 'c0000000-0000-0000-0000-000000000001', title: 'Hello World', content: 'This is my first post!', authorId: 'a0000000-0000-0000-0000-000000000001', status: 'published', createdAt: new Date().toISOString(), deletedAt: null },
    { id: 'c0000000-0000-0000-0000-000000000002', title: 'Design Tips', content: 'Here are some design tips...', authorId: 'a0000000-0000-0000-0000-000000000002', status: 'draft', createdAt: new Date().toISOString(), deletedAt: null },
  ];
  posts.forEach(p => postStore.set(p.id, p));

  // Seed comments
  const comments: Comment[] = [
    { id: 'd0000000-0000-0000-0000-000000000001', content: 'Great post!', postId: 'c0000000-0000-0000-0000-000000000001', authorId: 'a0000000-0000-0000-0000-000000000002', createdAt: new Date().toISOString() },
    { id: 'd0000000-0000-0000-0000-000000000002', content: 'Thanks for sharing!', postId: 'c0000000-0000-0000-0000-000000000001', authorId: 'a0000000-0000-0000-0000-000000000001', createdAt: new Date().toISOString() },
  ];
  comments.forEach(com => commentStore.set(com.id, com));

  // Seed categories
  const categories: Category[] = [
    { id: 'e0000000-0000-0000-0000-000000000001', name: 'Technology', description: 'Tech related posts', sortOrder: 1 },
    { id: 'e0000000-0000-0000-0000-000000000002', name: 'Science', description: 'Scientific articles', sortOrder: 2 },
    { id: 'e0000000-0000-0000-0000-000000000003', name: 'Art', description: null, sortOrder: 3 },
  ];
  categories.forEach(cat => categoryStore.set(cat.id, cat));

  return c.json({
    success: true,
    message: 'Seeded 3 users, 2 profiles, 2 posts, 2 comments, 3 categories',
  });
});

// Clear data
app.get('/clear', (c) => {
  clearStorage();
  return c.json({ success: true, message: 'All data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Comprehensive Example - Memory Adapter',
    version: '1.0.0',
    description: `
This API demonstrates ALL hono-crud features with the Memory adapter:

## Features

- **Basic CRUD**: Create, Read, Update, Delete, List
- **Soft Delete**: Records marked with deletedAt, ?withDeleted=true, ?onlyDeleted=true
- **Batch Operations**: /users/batch for create, update, delete, restore
- **Upsert**: PUT /categories for create-or-update by name
- **Relations**: ?include=posts,profile,comments
- **Filtering**: ?role=admin, ?age[gte]=18, ?name[ilike]=%alice%
- **Search**: ?search=john
- **Sorting**: ?order_by=name&order_by_direction=asc
- **Pagination**: ?page=1&per_page=20

## Testing

1. Seed data: GET /seed
2. Clear data: GET /clear
3. Explore via Swagger UI
    `,
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
setupReDoc(app, { redocPath: '/redoc', specPath: '/openapi.json', title: 'Comprehensive API' });
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'memory' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

console.log(`
=== Comprehensive Example (Memory Adapter) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs
ReDoc at http://localhost:${port}/redoc

Seed test data:
  curl http://localhost:${port}/seed

Quick tests:

# Basic CRUD
curl http://localhost:${port}/users
curl http://localhost:${port}/users/a0000000-0000-0000-0000-000000000001

# Relations
curl "http://localhost:${port}/users?include=posts,profile"
curl "http://localhost:${port}/posts?include=author,comments"

# Filtering
curl "http://localhost:${port}/users?role=admin"
curl "http://localhost:${port}/users?age[gte]=25"
curl "http://localhost:${port}/users?name[ilike]=%alice%"

# Search & Sort
curl "http://localhost:${port}/users?search=alice"
curl "http://localhost:${port}/users?order_by=name&order_by_direction=asc"

# Soft Delete
curl -X DELETE http://localhost:${port}/users/a0000000-0000-0000-0000-000000000003
curl "http://localhost:${port}/users?withDeleted=true"
curl -X POST http://localhost:${port}/users/a0000000-0000-0000-0000-000000000003/restore

# Batch Operations
curl -X POST http://localhost:${port}/users/batch -H "Content-Type: application/json" \\
  -d '{"items":[{"email":"new1@example.com","name":"New 1","role":"user"},{"email":"new2@example.com","name":"New 2","role":"guest"}]}'

# Upsert
curl -X PUT http://localhost:${port}/categories -H "Content-Type: application/json" \\
  -d '{"name":"Music","description":"Music posts","sortOrder":4}'
`);

serve({ fetch: app.fetch, port });
