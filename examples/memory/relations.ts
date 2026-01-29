/**
 * Example: Relations and Includes functionality
 *
 * Demonstrates how to use relations:
 * - Define relations on models (hasOne, hasMany, belongsTo)
 * - Include related data via ?include=relation1,relation2
 * - Control which relations are allowed via allowedIncludes
 *
 * Run with: npx tsx examples/relations.ts
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { fromHono, registerCrud, setupSwaggerUI, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryReadEndpoint,
  MemoryListEndpoint,
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
  name: z.string().min(1),
  email: z.email(),
  createdAt: z.string().datetime().optional(),
});

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  content: z.string(),
  authorId: z.uuid(),
  createdAt: z.string().datetime().optional(),
});

const CommentSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  postId: z.uuid(),
  authorId: z.uuid(),
  createdAt: z.string().datetime().optional(),
});

const ProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  bio: z.string().optional(),
  avatar: z.url().optional(),
});

// ============================================================================
// Models with Relations
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    // A user has many posts
    posts: {
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
    },
    // A user has one profile
    profile: {
      type: 'hasOne',
      model: 'profiles',
      foreignKey: 'userId',
    },
    // A user has many comments
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
    // A post belongs to a user (author)
    author: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'authorId',
      localKey: 'id',
    },
    // A post has many comments
    comments: {
      type: 'hasMany',
      model: 'comments',
      foreignKey: 'postId',
    },
  },
});

const CommentModel = defineModel({
  tableName: 'comments',
  schema: CommentSchema,
  primaryKeys: ['id'],
  relations: {
    // A comment belongs to a post
    post: {
      type: 'belongsTo',
      model: 'posts',
      foreignKey: 'postId',
      localKey: 'id',
    },
    // A comment belongs to a user (author)
    author: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'authorId',
      localKey: 'id',
    },
  },
});

const ProfileModel = defineModel({
  tableName: 'profiles',
  schema: ProfileSchema,
  primaryKeys: ['id'],
  relations: {
    // A profile belongs to a user
    user: {
      type: 'belongsTo',
      model: 'users',
      foreignKey: 'userId',
      localKey: 'id',
    },
  },
});

// ============================================================================
// Meta Definitions
// ============================================================================

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });
const commentMeta = defineMeta({ model: CommentModel });
const profileMeta = defineMeta({ model: ProfileModel });

// ============================================================================
// User Endpoints
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  schema = { tags: ['Users'], summary: 'Create a new user' };

  async before(data: z.infer<typeof UserSchema>) {
    return { ...data, createdAt: new Date().toISOString() };
  }
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  schema = {
    tags: ['Users'],
    summary: 'Get a user by ID',
    description: 'Use ?include=posts,profile,comments to load related data',
  };

  // Allow these relations to be included
  allowedIncludes = ['posts', 'profile', 'comments'];
}

class UserList extends MemoryListEndpoint {
  _meta = userMeta;
  schema = {
    tags: ['Users'],
    summary: 'List all users',
    description: 'Use ?include=posts,profile to load related data for each user',
  };

  searchFields = ['name', 'email'];

  // Allow these relations to be included
  allowedIncludes = ['posts', 'profile'];
}

// ============================================================================
// Post Endpoints
// ============================================================================

class PostCreate extends MemoryCreateEndpoint {
  _meta = postMeta;
  schema = { tags: ['Posts'], summary: 'Create a new post' };

  async before(data: z.infer<typeof PostSchema>) {
    return { ...data, createdAt: new Date().toISOString() };
  }
}

class PostRead extends MemoryReadEndpoint {
  _meta = postMeta;
  schema = {
    tags: ['Posts'],
    summary: 'Get a post by ID',
    description: 'Use ?include=author,comments to load related data',
  };

  allowedIncludes = ['author', 'comments'];
}

class PostList extends MemoryListEndpoint {
  _meta = postMeta;
  schema = {
    tags: ['Posts'],
    summary: 'List all posts',
    description: 'Use ?include=author,comments to load related data',
  };

  searchFields = ['title', 'content'];
  allowedIncludes = ['author', 'comments'];
}

// ============================================================================
// Comment Endpoints
// ============================================================================

class CommentCreate extends MemoryCreateEndpoint {
  _meta = commentMeta;
  schema = { tags: ['Comments'], summary: 'Create a new comment' };

  async before(data: z.infer<typeof CommentSchema>) {
    return { ...data, createdAt: new Date().toISOString() };
  }
}

class CommentRead extends MemoryReadEndpoint {
  _meta = commentMeta;
  schema = {
    tags: ['Comments'],
    summary: 'Get a comment by ID',
    description: 'Use ?include=post,author to load related data',
  };

  allowedIncludes = ['post', 'author'];
}

class CommentList extends MemoryListEndpoint {
  _meta = commentMeta;
  schema = {
    tags: ['Comments'],
    summary: 'List all comments',
    description: 'Use ?include=post,author to load related data',
  };

  allowedIncludes = ['post', 'author'];
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
  schema = {
    tags: ['Profiles'],
    summary: 'Get a profile by ID',
    description: 'Use ?include=user to load the associated user',
  };

  allowedIncludes = ['user'];
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());

// Register endpoints
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

registerCrud(app, '/comments', {
  create: CommentCreate,
  list: CommentList,
  read: CommentRead,
});

registerCrud(app, '/profiles', {
  create: ProfileCreate,
  read: ProfileRead,
});

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Relations Example API',
    version: '1.0.0',
    description: 'Demonstrates relation includes with ?include=relation1,relation2',
  },
});

// Swagger UI
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Seed some data for testing
app.get('/seed', async (c) => {
  clearStorage();

  // Create users
  const users = getStorage<z.infer<typeof UserSchema>>('users');
  const userId1 = 'a0000000-0000-0000-0000-000000000001';
  const userId2 = 'a0000000-0000-0000-0000-000000000002';

  users.set(userId1, {
    id: userId1,
    name: 'Alice',
    email: 'alice@example.com',
    createdAt: new Date().toISOString(),
  });
  users.set(userId2, {
    id: userId2,
    name: 'Bob',
    email: 'bob@example.com',
    createdAt: new Date().toISOString(),
  });

  // Create profiles
  const profiles = getStorage<z.infer<typeof ProfileSchema>>('profiles');
  const profileId1 = 'b0000000-0000-0000-0000-000000000001';
  const profileId2 = 'b0000000-0000-0000-0000-000000000002';

  profiles.set(profileId1, {
    id: profileId1,
    userId: userId1,
    bio: 'Alice is a developer',
    avatar: 'https://example.com/alice.jpg',
  });
  profiles.set(profileId2, {
    id: profileId2,
    userId: userId2,
    bio: 'Bob is a designer',
  });

  // Create posts
  const posts = getStorage<z.infer<typeof PostSchema>>('posts');
  const postId1 = 'c0000000-0000-0000-0000-000000000001';
  const postId2 = 'c0000000-0000-0000-0000-000000000002';

  posts.set(postId1, {
    id: postId1,
    title: 'Hello World',
    content: 'This is my first post!',
    authorId: userId1,
    createdAt: new Date().toISOString(),
  });
  posts.set(postId2, {
    id: postId2,
    title: 'Design Tips',
    content: 'Here are some design tips...',
    authorId: userId2,
    createdAt: new Date().toISOString(),
  });

  // Create comments
  const comments = getStorage<z.infer<typeof CommentSchema>>('comments');
  const commentId1 = 'd0000000-0000-0000-0000-000000000001';
  const commentId2 = 'd0000000-0000-0000-0000-000000000002';

  comments.set(commentId1, {
    id: commentId1,
    content: 'Great post!',
    postId: postId1,
    authorId: userId2,
    createdAt: new Date().toISOString(),
  });
  comments.set(commentId2, {
    id: commentId2,
    content: 'Thanks for sharing!',
    postId: postId1,
    authorId: userId1,
    createdAt: new Date().toISOString(),
  });

  return c.json({
    success: true,
    message: 'Test data seeded',
    data: {
      users: [userId1, userId2],
      profiles: [profileId1, profileId2],
      posts: [postId1, postId2],
      comments: [commentId1, commentId2],
    },
  });
});

// Start server
const port = Number(process.env.PORT) || 3456;
console.log(`
=== Relations Example ===

Server running at http://localhost:${port}
Swagger UI at http://localhost:${port}/docs

First, seed test data:
  curl http://localhost:${port}/seed

Then try these commands:

1. List users (no relations):
   curl http://localhost:${port}/users

2. List users with their posts:
   curl "http://localhost:${port}/users?include=posts"

3. List users with posts AND profile:
   curl "http://localhost:${port}/users?include=posts,profile"

4. Get a single user with all relations:
   curl "http://localhost:${port}/users/a0000000-0000-0000-0000-000000000001?include=posts,profile,comments"

5. List posts with author and comments:
   curl "http://localhost:${port}/posts?include=author,comments"

6. Get a post with author:
   curl "http://localhost:${port}/posts/c0000000-0000-0000-0000-000000000001?include=author"

7. List comments with their post and author:
   curl "http://localhost:${port}/comments?include=post,author"

Note: Only relations listed in allowedIncludes can be included.
Requesting an unlisted relation will be silently ignored.
`);

serve({
  fetch: app.fetch,
  port,
});
