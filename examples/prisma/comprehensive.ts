/**
 * Comprehensive Example: All Features with Prisma + PostgreSQL
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
 * 2. npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. npx prisma db push --schema=examples/prisma/schema.prisma
 * 4. npx tsx examples/prisma/comprehensive.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, setupReDoc, defineModel, defineMeta } from '../../src/index.js';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
  PrismaRestoreEndpoint,
  PrismaBatchCreateEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaUpsertEndpoint,
} from '../../src/adapters/prisma/index.js';
import {
  UserSchema,
  PostSchema,
  ProfileSchema,
  CommentSchema,
  CategorySchema,
  type User,
  type Post,
} from '../shared/schemas.js';
import { prisma, initDb, seedDb, clearDb } from './db.js';

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

class UserCreate extends PrismaCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prisma;

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
  orderByFields = ['name', 'age', 'createdAt'];
  defaultOrderBy = 'createdAt';
  defaultOrderDirection: 'asc' | 'desc' = 'desc';

  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserRead extends PrismaReadEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = { tags: ['Users'], summary: 'Get a user by ID' };
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserUpdate extends PrismaUpdateEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = { tags: ['Users'], summary: 'Update a user' };
  allowedUpdateFields = ['name', 'role', 'age', 'status'];
}

class UserDelete extends PrismaDeleteEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Delete a user (soft delete)' };
}

class UserRestore extends PrismaRestoreEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Restore a deleted user' };
}

class UserBatchCreate extends PrismaBatchCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users - Batch'], summary: 'Batch create users' };
  maxBatchSize = 100;
}

class UserBatchUpdate extends PrismaBatchUpdateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users - Batch'], summary: 'Batch update users' };
  maxBatchSize = 100;
  allowedUpdateFields = ['name', 'role', 'status'];
}

class UserBatchDelete extends PrismaBatchDeleteEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users - Batch'], summary: 'Batch delete users' };
  maxBatchSize = 100;
}

class UserBatchRestore extends PrismaBatchRestoreEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users - Batch'], summary: 'Batch restore users' };
  maxBatchSize = 100;
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends PrismaCreateEndpoint {
  _meta = postMeta;
  prisma = prisma;
  schema = { tags: ['Posts'], summary: 'Create a post' };
}

class PostList extends PrismaListEndpoint {
  _meta = postMeta;
  prisma = prisma;

  schema = { tags: ['Posts'], summary: 'List posts' };
  filterFields = ['status'];
  searchFields = ['title', 'content'];
  orderByFields = ['title', 'createdAt'];
  allowedIncludes = ['author', 'comments'];
}

class PostRead extends PrismaReadEndpoint {
  _meta = postMeta;
  prisma = prisma;

  schema = { tags: ['Posts'], summary: 'Get a post by ID' };
  allowedIncludes = ['author', 'comments'];
}

class PostUpdate extends PrismaUpdateEndpoint {
  _meta = postMeta;
  prisma = prisma;

  schema = { tags: ['Posts'], summary: 'Update a post' };
  allowedUpdateFields = ['title', 'content', 'status'];
}

class PostDelete extends PrismaDeleteEndpoint {
  _meta = postMeta;
  prisma = prisma;
  schema = { tags: ['Posts'], summary: 'Delete a post (soft delete)' };
}

class PostRestore extends PrismaRestoreEndpoint {
  _meta = postMeta;
  prisma = prisma;
  schema = { tags: ['Posts'], summary: 'Restore a deleted post' };
}

// ============================================================================
// Profile Endpoints
// ============================================================================

class ProfileCreate extends PrismaCreateEndpoint {
  _meta = profileMeta;
  prisma = prisma;
  schema = { tags: ['Profiles'], summary: 'Create a profile' };
}

class ProfileRead extends PrismaReadEndpoint {
  _meta = profileMeta;
  prisma = prisma;
  schema = { tags: ['Profiles'], summary: 'Get a profile by ID' };
  allowedIncludes = ['user'];
}

class ProfileUpdate extends PrismaUpdateEndpoint {
  _meta = profileMeta;
  prisma = prisma;
  schema = { tags: ['Profiles'], summary: 'Update a profile' };
  allowedUpdateFields = ['bio', 'avatar', 'website'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends PrismaCreateEndpoint {
  _meta = commentMeta;
  prisma = prisma;
  schema = { tags: ['Comments'], summary: 'Create a comment' };
}

class CommentList extends PrismaListEndpoint {
  _meta = commentMeta;
  prisma = prisma;
  schema = { tags: ['Comments'], summary: 'List comments' };
  allowedIncludes = ['post', 'author'];
}

class CommentRead extends PrismaReadEndpoint {
  _meta = commentMeta;
  prisma = prisma;
  schema = { tags: ['Comments'], summary: 'Get a comment by ID' };
  allowedIncludes = ['post', 'author'];
}

// ============================================================================
// Category Endpoints (Upsert)
// ============================================================================

class CategoryCreate extends PrismaCreateEndpoint {
  _meta = categoryMeta;
  prisma = prisma;
  schema = { tags: ['Categories'], summary: 'Create a category' };
}

class CategoryList extends PrismaListEndpoint {
  _meta = categoryMeta;
  prisma = prisma;

  schema = { tags: ['Categories'], summary: 'List categories' };
  filterFields = ['name'];
  filterConfig = {
    sortOrder: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const,
  };
  orderByFields = ['name', 'sortOrder'];
  defaultOrderBy = 'sortOrder';
}

class CategoryUpsert extends PrismaUpsertEndpoint {
  _meta = categoryMeta;
  prisma = prisma;

  schema = {
    tags: ['Categories'],
    summary: 'Upsert a category',
    description: 'Creates or updates a category by name.',
  };

  upsertKeys = ['name'];
  useNativeUpsert = true;
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
  await seedDb();
  return c.json({
    success: true,
    message: 'Seeded 3 users, 2 profiles, 2 posts, 2 comments, 3 categories',
  });
});

// Clear data
app.get('/clear', async (c) => {
  await clearDb();
  return c.json({ success: true, message: 'All data cleared' });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Comprehensive Example - Prisma + PostgreSQL',
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
app.get('/health', (c) => c.json({ status: 'ok', adapter: 'prisma', database: 'postgresql' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Comprehensive Example (Prisma + PostgreSQL) ===

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
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
