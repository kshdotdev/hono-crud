/**
 * Example: Relations with Prisma + PostgreSQL
 *
 * Demonstrates relation loading via ?include= parameter:
 * - hasMany: Users -> Posts, Posts -> Comments
 * - hasOne: Users -> Profiles
 * - belongsTo: Posts -> Users (author), Comments -> Users/Posts
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. npx prisma db push --schema=examples/prisma/schema.prisma
 * 4. npx tsx examples/prisma/relations.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  PrismaCreateEndpoint,
  PrismaReadEndpoint,
  PrismaListEndpoint,
} from '../../src/adapters/prisma/index.js';
import {
  UserSchema,
  PostSchema,
  ProfileSchema,
  CommentSchema,
} from '../shared/schemas.js';
import { prisma, initDb, seedDb } from './db.js';

// ============================================================================
// Models with Relations
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
    },
    profile: {
      type: 'hasOne',
      model: 'profiles',
      foreignKey: 'userId',
    },
    comments: {
      type: 'hasMany',
      model: 'comments',
      foreignKey: 'authorId',
    },
  },
});

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  relations: {
    author: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'authorId',
      localKey: 'id',
    },
    comments: {
      type: 'hasMany',
      model: 'comments',
      foreignKey: 'postId',
    },
  },
});

const ProfileModel = defineModel({
  tableName: 'profiles',
  schema: ProfileSchema,
  primaryKeys: ['id'],
  relations: {
    user: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'userId',
      localKey: 'id',
    },
  },
});

const CommentModel = defineModel({
  tableName: 'comments',
  schema: CommentSchema,
  primaryKeys: ['id'],
  relations: {
    post: {
      type: 'belongsTo',
      model: 'posts',
      foreignKey: 'postId',
      localKey: 'id',
    },
    author: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'authorId',
      localKey: 'id',
    },
  },
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const profileMeta = defineMeta({ model: ProfileModel });
const commentMeta = defineMeta({ model: CommentModel });

// ============================================================================
// User Endpoints
// ============================================================================

class UserCreate extends PrismaCreateEndpoint {
  _meta = userMeta;
  prisma = prisma;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserRead extends PrismaReadEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Use ?include=posts,profile,comments to load related data',
  };

  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserList extends PrismaListEndpoint {
  _meta = userMeta;
  prisma = prisma;

  schema = {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Use ?include=posts,profile to load related data',
  };

  searchFields = ['name', 'email'];
  allowedIncludes = ['posts', 'profile'];
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends PrismaCreateEndpoint {
  _meta = postMeta;
  prisma = prisma;
  schema = { tags: ['Posts'], summary: 'Create a post' };
}

class PostRead extends PrismaReadEndpoint {
  _meta = postMeta;
  prisma = prisma;

  schema = {
    tags: ['Posts'],
    summary: 'Get a post by ID',
    description: 'Use ?include=author,comments to load related data',
  };

  allowedIncludes = ['author', 'comments'];
}

class PostList extends PrismaListEndpoint {
  _meta = postMeta;
  prisma = prisma;

  schema = {
    tags: ['Posts'],
    summary: 'List all posts',
    description: 'Use ?include=author,comments to load related data',
  };

  searchFields = ['title', 'content'];
  allowedIncludes = ['author', 'comments'];
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

  schema = {
    tags: ['Profiles'],
    summary: 'Get a profile by ID',
    description: 'Use ?include=user to load the associated user',
  };

  allowedIncludes = ['user'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends PrismaCreateEndpoint {
  _meta = commentMeta;
  prisma = prisma;
  schema = { tags: ['Comments'], summary: 'Create a comment' };
}

class CommentRead extends PrismaReadEndpoint {
  _meta = commentMeta;
  prisma = prisma;

  schema = {
    tags: ['Comments'],
    summary: 'Get a comment by ID',
    description: 'Use ?include=post,author to load related data',
  };

  allowedIncludes = ['post', 'author'];
}

class CommentList extends PrismaListEndpoint {
  _meta = commentMeta;
  prisma = prisma;

  schema = {
    tags: ['Comments'],
    summary: 'List all comments',
    description: 'Use ?include=post,author to load related data',
  };

  allowedIncludes = ['post', 'author'];
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

registerCrud(app, '/users', {
  create: UserCreate,
  list: UserList,
  read: UserRead,
});

registerCrud(app, '/posts', {
  create: PostCreate,
  list: PostList,
  read: PostRead,
});

registerCrud(app, '/profiles', {
  create: ProfileCreate,
  read: ProfileRead,
});

registerCrud(app, '/comments', {
  create: CommentCreate,
  list: CommentList,
  read: CommentRead,
});

// Seed endpoint
app.get('/seed', async (c) => {
  await seedDb();
  return c.json({
    success: true,
    message: 'Seeded 3 users, 2 profiles, 2 posts, 2 comments',
    data: {
      users: ['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'],
      posts: ['c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002'],
    },
  });
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Relations Example - Prisma + PostgreSQL',
    version: '1.0.0',
    description: 'Demonstrates relation loading with ?include= parameter.',
  },
});

setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================================
// Start Server
// ============================================================================

const port = Number(process.env.PORT) || 3456;

initDb()
  .then(() => {
    console.log(`
=== Relations Example (Prisma + PostgreSQL) ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, seed the test data:
  curl http://localhost:${port}/seed

Then try these relation queries:

USERS:
  # List users (no relations)
  curl http://localhost:${port}/users

  # List users with their posts
  curl "http://localhost:${port}/users?include=posts"

  # List users with posts AND profile
  curl "http://localhost:${port}/users?include=posts,profile"

  # Get a single user with all relations
  curl "http://localhost:${port}/users/a0000000-0000-0000-0000-000000000001?include=posts,profile,comments"

POSTS:
  # List posts with author and comments
  curl "http://localhost:${port}/posts?include=author,comments"

  # Get a post with author
  curl "http://localhost:${port}/posts/c0000000-0000-0000-0000-000000000001?include=author"

COMMENTS:
  # List comments with their post and author
  curl "http://localhost:${port}/comments?include=post,author"

Note: Only relations listed in allowedIncludes can be included.
Requesting an unlisted relation will be silently ignored.
`);

    serve({ fetch: app.fetch, port });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
