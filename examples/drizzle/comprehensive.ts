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

import {
  DrizzleCloneEndpoint,
  type DrizzleDatabaseConstraint,
  createDrizzleCrud,
} from '@hono-crud/drizzle';
import { scalarUI } from '@hono-crud/scalar';
import { redocUI, swaggerUI } from '@hono-crud/swagger';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import {
  CategorySchema,
  CommentSchema,
  type Post,
  PostSchema,
  ProfileSchema,
  type User,
  UserSchema,
} from '../shared/schemas.js';
import { db, initDb, pool } from './db.js';
import { categories, comments, posts, profiles, users } from './schema.js';

const typedDb = db as unknown as DrizzleDatabaseConstraint;

// ============================================================================
// Models with Full Configuration
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  tag: 'Users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
  softDelete: true,
  relations: {
    posts: { type: 'hasMany', model: 'posts', table: posts, foreignKey: 'authorId' },
    profile: { type: 'hasOne', model: 'profiles', table: profiles, foreignKey: 'userId' },
    comments: { type: 'hasMany', model: 'comments', table: comments, foreignKey: 'authorId' },
  },
});

const PostModel = defineModel({
  tableName: 'posts',
  tag: 'Posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  table: posts,
  softDelete: true,
  relations: {
    author: {
      type: 'belongsTo',
      model: 'users',
      table: users,
      foreignKey: 'authorId',
      localKey: 'id',
    },
    comments: { type: 'hasMany', model: 'comments', table: comments, foreignKey: 'postId' },
  },
});

const ProfileModel = defineModel({
  tableName: 'profiles',
  tag: 'Profiles',
  schema: ProfileSchema,
  primaryKeys: ['id'],
  table: profiles,
  relations: {
    user: { type: 'belongsTo', model: 'users', table: users, foreignKey: 'userId', localKey: 'id' },
  },
});

const CommentModel = defineModel({
  tableName: 'comments',
  tag: 'Comments',
  schema: CommentSchema,
  primaryKeys: ['id'],
  table: comments,
  relations: {
    post: { type: 'belongsTo', model: 'posts', table: posts, foreignKey: 'postId', localKey: 'id' },
    author: {
      type: 'belongsTo',
      model: 'users',
      table: users,
      foreignKey: 'authorId',
      localKey: 'id',
    },
  },
});

const CategoryModel = defineModel({
  tableName: 'categories',
  tag: 'Categories',
  schema: CategorySchema,
  primaryKeys: ['id'],
  table: categories,
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const profileMeta = defineMeta({ model: ProfileModel });
const commentMeta = defineMeta({ model: CommentModel });
const categoryMeta = defineMeta({ model: CategoryModel });

// Factory bundles: `db`/`_meta` are stamped, `dialect: 'pg'` is applied to the
// dialect-aware verbs, and OpenAPI `tags` default from each model's `tag`. The
// endpoint classes below drop all of that boilerplate; an explicit `schema.tags`
// (e.g. the 'Users - Batch' group) still wins.
const Users = createDrizzleCrud(typedDb, userMeta, { dialect: 'pg' });
const Posts = createDrizzleCrud(typedDb, postMeta, { dialect: 'pg' });
const Profiles = createDrizzleCrud(typedDb, profileMeta, { dialect: 'pg' });
const Comments = createDrizzleCrud(typedDb, commentMeta, { dialect: 'pg' });
const Categories = createDrizzleCrud(typedDb, categoryMeta, { dialect: 'pg' });

// ============================================================================
// User Endpoints (Full CRUD + Batch + Relations)
// ============================================================================

class UserCreate extends Users.Create {
  schema = { summary: 'Create a user' };
}

class UserList extends Users.List {
  schema = {
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

class UserRead extends Users.Read {
  schema = { summary: 'Get a user by ID' };
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserUpdate extends Users.Update {
  schema = { summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends Users.Delete {
  schema = { summary: 'Delete a user (soft delete)' };
}

class UserRestore extends Users.Restore {
  schema = { summary: 'Restore a deleted user' };
}

class UserBatchCreate extends Users.BatchCreate {
  schema = { tags: ['Users - Batch'], summary: 'Batch create users' };
  maxBatchSize = 100;
}

class UserBatchUpdate extends Users.BatchUpdate {
  schema = { tags: ['Users - Batch'], summary: 'Batch update users' };
  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserBatchDelete extends Users.BatchDelete {
  schema = { tags: ['Users - Batch'], summary: 'Batch delete users' };
  maxBatchSize = 100;
}

class UserBatchRestore extends Users.BatchRestore {
  schema = { tags: ['Users - Batch'], summary: 'Batch restore users' };
  maxBatchSize = 100;
}

// Clone is not part of the createDrizzleCrud factory surface, so this one keeps
// the explicit `_meta`/`db` wiring.
class UserClone extends DrizzleCloneEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = {
    tags: ['Users'],
    summary: 'Clone a user',
    description:
      'Duplicates the source user, generating a fresh primary key. ' +
      'The body must supply a unique `email` (the column has a UNIQUE constraint); ' +
      'name/role/age/status default to the source row unless overridden in the body. ' +
      '`createdAt`, `updatedAt`, and `deletedAt` are stripped so the new row picks up DB defaults.',
  };
  excludeFromClone = ['createdAt', 'updatedAt', 'deletedAt'];
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends Posts.Create {
  schema = { summary: 'Create a post' };
}

class PostList extends Posts.List {
  schema = { summary: 'List posts' };
  filterFields = ['status'];
  searchFields = ['title', 'content'];
  sortFields = ['title', 'createdAt'];
  allowedIncludes = ['author', 'comments'];
}

class PostRead extends Posts.Read {
  schema = { summary: 'Get a post by ID' };
  allowedIncludes = ['author', 'comments'];
}

class PostUpdate extends Posts.Update {
  schema = { summary: 'Update a post' };
  allowedUpdateFields = ['title', 'content', 'status'];
}

class PostDelete extends Posts.Delete {
  schema = { summary: 'Delete a post (soft delete)' };
}

class PostRestore extends Posts.Restore {
  schema = { summary: 'Restore a deleted post' };
}

// ============================================================================
// Profile Endpoints
// ============================================================================

class ProfileCreate extends Profiles.Create {
  schema = { summary: 'Create a profile' };
}

class ProfileRead extends Profiles.Read {
  schema = { summary: 'Get a profile by ID' };
  allowedIncludes = ['user'];
}

class ProfileUpdate extends Profiles.Update {
  schema = { summary: 'Update a profile' };
  allowedUpdateFields = ['bio', 'avatar', 'website'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends Comments.Create {
  schema = { summary: 'Create a comment' };
}

class CommentList extends Comments.List {
  schema = { summary: 'List comments' };
  allowedIncludes = ['post', 'author'];
}

class CommentRead extends Comments.Read {
  schema = { summary: 'Get a comment by ID' };
  allowedIncludes = ['post', 'author'];
}

// ============================================================================
// Category Endpoints (Upsert)
// ============================================================================

class CategoryCreate extends Categories.Create {
  schema = { summary: 'Create a category' };
}

class CategoryList extends Categories.List {
  schema = { summary: 'List categories' };
  filterFields = ['name'];
  filterConfig = {
    sortOrder: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
  };
  sortFields = ['name', 'sortOrder'];
  defaultSort = { field: 'sortOrder', order: 'asc' as const };
}

class CategoryUpsert extends Categories.Upsert {
  schema = {
    summary: 'Upsert a category',
    description: 'Creates or updates a category by name.',
  };

  upsertKeys = ['name'];
}

// ============================================================================
// App Setup
// ============================================================================

export const app = fromHono(new Hono());

// Users (full CRUD + batch + clone)
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
  clone: UserClone,
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

app.get('/docs', swaggerUI({ specUrl: '/openapi.json' }));
app.get('/redoc', redocUI({ specUrl: '/openapi.json', pageTitle: 'Comprehensive API' }));
app.get('/reference', scalarUI({ specUrl: '/openapi.json', theme: 'purple' }));
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'drizzle', database: 'postgresql' }));

// ============================================================================
// Start Server
// ============================================================================

export async function start(port: number = Number(process.env.PORT) || 3456): Promise<void> {
  await initDb();
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}
