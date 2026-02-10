/**
 * Comprehensive Example: All Features with Drizzle + PostgreSQL
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
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/comprehensive.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, setupReDoc, setupScalar, defineModel, defineMeta } from '../../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  DrizzleRestoreEndpoint,
  DrizzleBatchCreateEndpoint,
  DrizzleBatchUpdateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
  DrizzleUpsertEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import {
  UserSchema,
  PostSchema,
  ProfileSchema,
  CommentSchema,
  CategorySchema,
  type User,
  type Post,
} from '../shared/schemas.js';
import { users, posts, profiles, comments, categories } from './schema.js';
import { db, initDb, pool } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// Models with Full Configuration
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
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
  table: posts,
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
  table: profiles,
  relations: {
    user: { type: 'belongsTo', model: 'users', foreignKey: 'userId', localKey: 'id' },
  },
});

const CommentModel = defineModel({
  tableName: 'comments',
  schema: CommentSchema,
  primaryKeys: ['id'],
  table: comments,
  relations: {
    post: { type: 'belongsTo', model: 'posts', foreignKey: 'postId', localKey: 'id' },
    author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId', localKey: 'id' },
  },
});

const CategoryModel = defineModel({
  tableName: 'categories',
  schema: CategorySchema,
  primaryKeys: ['id'],
  table: categories,
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const profileMeta = defineMeta({ model: ProfileModel });
const commentMeta = defineMeta({ model: CommentModel });
const categoryMeta = defineMeta({ model: CategoryModel });

// ============================================================================
// User Endpoints (Full CRUD + Batch + Relations)
// ============================================================================

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
    summary: 'List users',
    description: 'Full filtering, searching, sorting, pagination, and relation loading.',
  };

  filterFields = ['role', 'status'];
  filterConfig = {
    age: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'null'] as const,
    name: ['eq', 'like', 'ilike'] as const,
    email: ['eq', 'like', 'ilike'] as const,
    createdAt: ['gt', 'gte', 'lt', 'lte', 'between'] as const,
  };

  searchFields = ['name', 'email'];
  sortFields = ['name', 'age', 'createdAt'];
  defaultSort = { field: 'createdAt', order: 'desc' as const };

  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserRead extends DrizzleReadEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = { tags: ['Users'], summary: 'Get a user by ID' };
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserUpdate extends DrizzleUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends DrizzleDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Delete a user (soft delete)' };
}

class UserRestore extends DrizzleRestoreEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

class UserBatchCreate extends DrizzleBatchCreateEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users - Batch'], summary: 'Batch create users' };
  maxBatchSize = 100;
}

class UserBatchUpdate extends DrizzleBatchUpdateEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users - Batch'], summary: 'Batch update users' };
  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserBatchDelete extends DrizzleBatchDeleteEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users - Batch'], summary: 'Batch delete users' };
  maxBatchSize = 100;
}

class UserBatchRestore extends DrizzleBatchRestoreEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users - Batch'], summary: 'Batch restore users' };
  maxBatchSize = 100;
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends DrizzleCreateEndpoint {
  _meta = postMeta;
  db = typedDb;
  schema = { tags: ['Posts'], summary: 'Create a post' };
}

class PostList extends DrizzleListEndpoint {
  _meta = postMeta;
  db = typedDb;

  schema = { tags: ['Posts'], summary: 'List posts' };
  filterFields = ['status'];
  searchFields = ['title', 'content'];
  sortFields = ['title', 'createdAt'];
  allowedIncludes = ['author', 'comments'];
}

class PostRead extends DrizzleReadEndpoint {
  _meta = postMeta;
  db = typedDb;

  schema = { tags: ['Posts'], summary: 'Get a post by ID' };
  allowedIncludes = ['author', 'comments'];
}

class PostUpdate extends DrizzleUpdateEndpoint {
  _meta = postMeta;
  db = typedDb;

  schema = { tags: ['Posts'], summary: 'Update a post' };
  allowedUpdateFields = ['title', 'content', 'status'];
}

class PostDelete extends DrizzleDeleteEndpoint {
  _meta = postMeta;
  db = typedDb;
  schema = { tags: ['Posts'], summary: 'Delete a post (soft delete)' };
}

class PostRestore extends DrizzleRestoreEndpoint {
  _meta = postMeta;
  db = typedDb;
  schema = { tags: ['Posts'], summary: 'Restore a deleted post' };
}

// ============================================================================
// Profile Endpoints
// ============================================================================

class ProfileCreate extends DrizzleCreateEndpoint {
  _meta = profileMeta;
  db = typedDb;
  schema = { tags: ['Profiles'], summary: 'Create a profile' };
}

class ProfileRead extends DrizzleReadEndpoint {
  _meta = profileMeta;
  db = typedDb;
  schema = { tags: ['Profiles'], summary: 'Get a profile by ID' };
  allowedIncludes = ['user'];
}

class ProfileUpdate extends DrizzleUpdateEndpoint {
  _meta = profileMeta;
  db = typedDb;
  schema = { tags: ['Profiles'], summary: 'Update a profile' };
  allowedUpdateFields = ['bio', 'avatar', 'website'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends DrizzleCreateEndpoint {
  _meta = commentMeta;
  db = typedDb;
  schema = { tags: ['Comments'], summary: 'Create a comment' };
}

class CommentList extends DrizzleListEndpoint {
  _meta = commentMeta;
  db = typedDb;
  schema = { tags: ['Comments'], summary: 'List comments' };
  allowedIncludes = ['post', 'author'];
}

class CommentRead extends DrizzleReadEndpoint {
  _meta = commentMeta;
  db = typedDb;
  schema = { tags: ['Comments'], summary: 'Get a comment by ID' };
  allowedIncludes = ['post', 'author'];
}

// ============================================================================
// Category Endpoints (Upsert)
// ============================================================================

class CategoryCreate extends DrizzleCreateEndpoint {
  _meta = categoryMeta;
  db = typedDb;
  schema = { tags: ['Categories'], summary: 'Create a category' };
}

class CategoryList extends DrizzleListEndpoint {
  _meta = categoryMeta;
  db = typedDb;

  schema = { tags: ['Categories'], summary: 'List categories' };
  filterFields = ['name'];
  filterConfig = {
    sortOrder: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
  };
  sortFields = ['name', 'sortOrder'];
  defaultSort = { field: 'sortOrder', order: 'asc' as const };
}

class CategoryUpsert extends DrizzleUpsertEndpoint {
  _meta = categoryMeta;
  db = typedDb;

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
  await pool.query('TRUNCATE comments, posts, profiles, users, categories CASCADE');

  // Seed users
  await pool.query(`
    INSERT INTO users (id, email, name, role, age, status, created_at, updated_at)
    VALUES
      ('a0000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice Admin', 'admin', 35, 'active', NOW(), NOW()),
      ('a0000000-0000-0000-0000-000000000002', 'bob@example.com', 'Bob User', 'user', 28, 'active', NOW(), NOW()),
      ('a0000000-0000-0000-0000-000000000003', 'charlie@example.com', 'Charlie Guest', 'guest', 22, 'pending', NOW(), NOW())
  `);

  // Seed profiles
  await pool.query(`
    INSERT INTO profiles (id, user_id, bio, avatar)
    VALUES
      ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alice is a developer', 'https://example.com/alice.jpg'),
      ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bob is a designer', NULL)
  `);

  // Seed posts
  await pool.query(`
    INSERT INTO posts (id, title, content, author_id, status, created_at, updated_at)
    VALUES
      ('c0000000-0000-0000-0000-000000000001', 'Hello World', 'This is my first post!', 'a0000000-0000-0000-0000-000000000001', 'published', NOW(), NOW()),
      ('c0000000-0000-0000-0000-000000000002', 'Design Tips', 'Here are some design tips...', 'a0000000-0000-0000-0000-000000000002', 'draft', NOW(), NOW())
  `);

  // Seed comments
  await pool.query(`
    INSERT INTO comments (id, content, post_id, author_id)
    VALUES
      ('d0000000-0000-0000-0000-000000000001', 'Great post!', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'),
      ('d0000000-0000-0000-0000-000000000002', 'Thanks for sharing!', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
  `);

  // Seed categories
  await pool.query(`
    INSERT INTO categories (id, name, description, sort_order)
    VALUES
      ('e0000000-0000-0000-0000-000000000001', 'Technology', 'Tech related posts', 1),
      ('e0000000-0000-0000-0000-000000000002', 'Science', 'Scientific articles', 2),
      ('e0000000-0000-0000-0000-000000000003', 'Art', NULL, 3)
  `);

  return c.json({
    success: true,
    message: 'Seeded 3 users, 2 profiles, 2 posts, 2 comments, 3 categories',
  });
});

// Clear data
app.get('/clear', async (c) => {
  await pool.query('TRUNCATE comments, posts, profiles, users, categories CASCADE');
  return c.json({ success: true, message: 'All data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Comprehensive Example - Drizzle + PostgreSQL',
    version: '1.0.0',
    description: `
This API demonstrates ALL hono-crud features:

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
setupScalar(app, '/reference', { specUrl: '/openapi.json', theme: 'purple' });
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'drizzle', database: 'postgresql' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Comprehensive Example (Drizzle + PostgreSQL) ===

Server running at http://localhost:${port}

Documentation:
  Swagger UI:     http://localhost:${port}/docs
  ReDoc:          http://localhost:${port}/redoc
  Scalar:         http://localhost:${port}/reference

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
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
