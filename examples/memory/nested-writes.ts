/**
 * Example: Nested Writes
 *
 * Demonstrates creating and updating related records in a single request.
 *
 * Run with: npx tsx examples/nested-writes.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryReadEndpoint,
  clearStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage
clearStorage();

// ============================================================================
// Schema Definitions
// ============================================================================

const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
});

const ProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  bio: z.string(),
  website: z.url().optional(),
});

const PostSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  title: z.string(),
  content: z.string(),
  published: z.boolean().default(false),
});

const CommentSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  authorName: z.string(),
  content: z.string(),
});

// ============================================================================
// Model Definitions with Nested Writes
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    // hasOne relation - user has one profile
    profile: {
      type: 'hasOne',
      model: 'profiles',
      foreignKey: 'userId',
      schema: ProfileSchema,
      nestedWrites: {
        allowCreate: true,
        allowUpdate: true,
        allowDelete: true,
      },
    },
    // hasMany relation - user has many posts
    posts: {
      type: 'hasMany',
      model: 'posts',
      foreignKey: 'authorId',
      schema: PostSchema,
      nestedWrites: {
        allowCreate: true,
        allowUpdate: true,
        allowDelete: true,
        allowConnect: true,
        allowDisconnect: true,
      },
    },
  },
});

const PostModel = defineModel({
  tableName: 'posts',
  schema: PostSchema,
  primaryKeys: ['id'],
  relations: {
    // hasMany relation - post has many comments
    comments: {
      type: 'hasMany',
      model: 'comments',
      foreignKey: 'postId',
      schema: CommentSchema,
      nestedWrites: {
        allowCreate: true,
      },
    },
  },
});

const userMeta = defineMeta({ model: UserModel });
const postMeta = defineMeta({ model: PostModel });

// ============================================================================
// Endpoints
// ============================================================================

class UserCreate extends MemoryCreateEndpoint {
  _meta = userMeta;
  allowNestedCreate = ['profile', 'posts'];
}

class UserUpdate extends MemoryUpdateEndpoint {
  _meta = userMeta;
  allowNestedWrites = ['profile', 'posts'];
}

class UserRead extends MemoryReadEndpoint {
  _meta = userMeta;
  allowedIncludes = ['profile', 'posts'];
}

class PostCreate extends MemoryCreateEndpoint {
  _meta = postMeta;
  allowNestedCreate = ['comments'];
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());
app.post('/users', UserCreate);
app.get('/users/:id', UserRead);
app.patch('/users/:id', UserUpdate);
app.post('/posts', PostCreate);

// ============================================================================
// Demo
// ============================================================================

async function main() {
  console.log('=== Nested Writes Demo ===\n');

  // 1. Create a user with nested profile and posts in one request
  console.log('1. Creating user with nested profile and posts...');
  const createRes = await app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice Johnson',
      email: 'alice@example.com',
      // Nested hasOne - create profile along with user
      profile: {
        bio: 'Full-stack developer and open source enthusiast',
        website: 'https://alice.dev',
      },
      // Nested hasMany - create multiple posts
      posts: [
        { title: 'Hello World', content: 'My first post!', published: true },
        { title: 'TypeScript Tips', content: 'Here are some tips...' },
      ],
    }),
  });

  const createResult = await createRes.json();
  console.log('Created:', JSON.stringify(createResult.result, null, 2));
  const userId = createResult.result.id;
  const postId = createResult.result.posts[0].id;
  console.log();

  // 2. Update user with nested operations
  console.log('2. Updating user - add new post, update existing...');
  const updateRes = await app.request(`/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice J. Johnson',
      posts: {
        // Create new post
        create: [{ title: 'New Post', content: 'Created during update' }],
        // Update existing post
        update: [{ id: postId, title: 'Hello World - Updated!' }],
      },
    }),
  });

  const updateResult = await updateRes.json();
  console.log('Updated:', JSON.stringify(updateResult.result, null, 2));
  console.log();

  // 3. Read user with includes
  console.log('3. Reading user with profile and posts...');
  const readRes = await app.request(`/users/${userId}?include=profile,posts`);
  const readResult = await readRes.json();
  console.log('User with relations:', JSON.stringify(readResult.result, null, 2));
  console.log();

  // 4. Create post with nested comments
  console.log('4. Creating post with nested comments...');
  const postRes = await app.request('/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authorId: userId,
      title: 'Post with Comments',
      content: 'This post has comments created inline',
      published: true,
      // Nested hasMany - create comments with the post
      comments: [
        { authorName: 'Bob', content: 'Great post!' },
        { authorName: 'Charlie', content: 'Very informative.' },
      ],
    }),
  });

  const postResult = await postRes.json();
  console.log('Created post:', JSON.stringify(postResult.result, null, 2));
  console.log();

  console.log('=== Demo Complete ===');
}

main().catch(console.error);
