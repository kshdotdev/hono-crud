/**
 * Example: Relations with Drizzle + PostgreSQL
 *
 * Demonstrates relation loading via ?include= parameter:
 * - hasMany: Users -> Posts, Posts -> Comments
 * - hasOne: Users -> Profiles
 * - belongsTo: Posts -> Users (author), Comments -> Users/Posts
 *
 * Run with:
 * 1. cd examples && docker compose up -d
 * 2. npx tsx examples/drizzle/relations.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleListEndpoint,
  type DrizzleDatabase,
} from '../../src/adapters/drizzle/index.js';
import {
  UserSchema,
  PostSchema,
  ProfileSchema,
  CommentSchema,
} from '../shared/schemas.js';
import { users, posts, profiles, comments } from './schema.js';
import { db, initDb, pool } from './db.js';

const typedDb = db as unknown as DrizzleDatabase;

// ============================================================================
// Models with Relations
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  table: users,
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
  table: posts,
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
  table: profiles,
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
  table: comments,
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

class UserCreate extends DrizzleCreateEndpoint {
  _meta = userMeta;
  db = typedDb;
  schema = { tags: ['Users'], summary: 'Create a user' };
}

class UserRead extends DrizzleReadEndpoint {
  _meta = userMeta;
  db = typedDb;

  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Use ?include=posts,profile,comments to load related data',
  };

  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserList extends DrizzleListEndpoint {
  _meta = userMeta;
  db = typedDb;

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

class PostCreate extends DrizzleCreateEndpoint {
  _meta = postMeta;
  db = typedDb;
  schema = { tags: ['Posts'], summary: 'Create a post' };
}

class PostRead extends DrizzleReadEndpoint {
  _meta = postMeta;
  db = typedDb;

  schema = {
    tags: ['Posts'],
    summary: 'Get a post by ID',
    description: 'Use ?include=author,comments to load related data',
  };

  allowedIncludes = ['author', 'comments'];
}

class PostList extends DrizzleListEndpoint {
  _meta = postMeta;
  db = typedDb;

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

class ProfileCreate extends DrizzleCreateEndpoint {
  _meta = profileMeta;
  db = typedDb;
  schema = { tags: ['Profiles'], summary: 'Create a profile' };
}

class ProfileRead extends DrizzleReadEndpoint {
  _meta = profileMeta;
  db = typedDb;

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

class CommentCreate extends DrizzleCreateEndpoint {
  _meta = commentMeta;
  db = typedDb;
  schema = { tags: ['Comments'], summary: 'Create a comment' };
}

class CommentRead extends DrizzleReadEndpoint {
  _meta = commentMeta;
  db = typedDb;

  schema = {
    tags: ['Comments'],
    summary: 'Get a comment by ID',
    description: 'Use ?include=post,author to load related data',
  };

  allowedIncludes = ['post', 'author'];
}

class CommentList extends DrizzleListEndpoint {
  _meta = commentMeta;
  db = typedDb;

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
  await pool.query('TRUNCATE comments, posts, profiles, users CASCADE');

  // Create users
  const userResult = await pool.query(`
    INSERT INTO users (id, email, name, role, status)
    VALUES
      ('a0000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice', 'admin', 'active'),
      ('a0000000-0000-0000-0000-000000000002', 'bob@example.com', 'Bob', 'user', 'active')
    RETURNING id
  `);

  // Create profiles
  await pool.query(`
    INSERT INTO profiles (id, user_id, bio, avatar)
    VALUES
      ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alice is a developer', 'https://example.com/alice.jpg'),
      ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bob is a designer', NULL)
  `);

  // Create posts
  await pool.query(`
    INSERT INTO posts (id, title, content, author_id, status)
    VALUES
      ('c0000000-0000-0000-0000-000000000001', 'Hello World', 'This is my first post!', 'a0000000-0000-0000-0000-000000000001', 'published'),
      ('c0000000-0000-0000-0000-000000000002', 'Design Tips', 'Here are some design tips...', 'a0000000-0000-0000-0000-000000000002', 'draft')
  `);

  // Create comments
  await pool.query(`
    INSERT INTO comments (id, content, post_id, author_id)
    VALUES
      ('d0000000-0000-0000-0000-000000000001', 'Great post!', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'),
      ('d0000000-0000-0000-0000-000000000002', 'Thanks for sharing!', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
  `);

  return c.json({
    success: true,
    message: 'Seeded 2 users, 2 profiles, 2 posts, 2 comments',
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
    title: 'Relations Example - Drizzle + PostgreSQL',
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
=== Relations Example (Drizzle + PostgreSQL) ===

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
