/**
 * Tests for Nested Writes functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryReadEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

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
  avatar: z.string().optional(),
});

const PostSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid().nullable(),
  title: z.string(),
  content: z.string(),
});

type User = z.infer<typeof UserSchema>;
type Profile = z.infer<typeof ProfileSchema>;
type Post = z.infer<typeof PostSchema>;

// ============================================================================
// Model Definitions with Nested Writes
// ============================================================================

const UserModel = defineModel({
  tableName: 'users',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
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

const userMeta = defineMeta({ model: UserModel });

// ============================================================================
// Endpoint Classes
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

// ============================================================================
// Tests
// ============================================================================

describe('Nested Writes', () => {
  let app: ReturnType<typeof fromHono>;
  let userStore: Map<string, User>;
  let profileStore: Map<string, Profile>;
  let postStore: Map<string, Post>;

  beforeEach(() => {
    clearStorage();
    userStore = getStorage<User>('users');
    profileStore = getStorage<Profile>('profiles');
    postStore = getStorage<Post>('posts');

    app = fromHono(new Hono());
    app.post('/users', UserCreate);
    app.get('/users/:id', UserRead);
    app.patch('/users/:id', UserUpdate);
  });

  describe('create with nested data', () => {
    it('should create user with nested hasOne profile', async () => {
      const response = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          profile: {
            bio: 'Software developer',
            avatar: 'https://example.com/avatar.jpg',
          },
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { success: boolean; result: User & { profile?: Profile } };
      expect(result.success).toBe(true);
      expect(result.result.name).toBe('John Doe');
      expect(result.result.profile).toBeDefined();
      expect(result.result.profile?.bio).toBe('Software developer');
    });

    it('should create user with nested hasMany posts', async () => {
      const response = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Smith',
          email: 'jane@example.com',
          posts: [
            { title: 'First Post', content: 'Hello World!' },
            { title: 'Second Post', content: 'More content here.' },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json() as { result: User & { posts?: Post[] } };
      expect(result.result.posts).toBeDefined();
      expect(result.result.posts).toHaveLength(2);
    });
  });

  describe('update with nested operations', () => {
    let userId: string;

    beforeEach(async () => {
      // Create a user first
      const response = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
        }),
      });
      const result = await response.json() as { result: User };
      userId = result.result.id;
    });

    it('should update user and create nested posts', async () => {
      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Doe Updated',
          posts: {
            create: [{ title: 'New Post', content: 'Created during update' }],
          },
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as { result: User & { posts: Post[] } };
      expect(result.result.name).toBe('John Doe Updated');
      expect(result.result.posts).toHaveLength(1);
    });

    it('should update nested posts', async () => {
      // First create a post
      const createRes = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            create: [{ title: 'Original Title', content: 'Content' }],
          },
        }),
      });
      const createResult = await createRes.json() as { result: { posts: Post[] } };
      const postId = createResult.result.posts[0].id;

      // Then update it
      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            update: [{ id: postId, title: 'Updated Title' }],
          },
        }),
      });

      expect(response.status).toBe(200);
      const post = postStore.get(postId);
      expect(post?.title).toBe('Updated Title');
    });

    it('should delete nested posts', async () => {
      // First create a post
      const createRes = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            create: [{ title: 'To Delete', content: 'Content' }],
          },
        }),
      });
      const createResult = await createRes.json() as { result: { posts: Post[] } };
      const postId = createResult.result.posts[0].id;

      expect(postStore.has(postId)).toBe(true);

      // Then delete it
      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            delete: [postId],
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(postStore.has(postId)).toBe(false);
    });

    it('should connect existing records', async () => {
      // Create an orphan post
      const orphanPost: Post = {
        id: crypto.randomUUID(),
        authorId: null,
        title: 'Orphan Post',
        content: 'No author',
      };
      postStore.set(orphanPost.id, orphanPost);

      // Connect it to the user
      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            connect: [orphanPost.id],
          },
        }),
      });

      expect(response.status).toBe(200);
      const post = postStore.get(orphanPost.id);
      expect(post?.authorId).toBe(userId);
    });

    it('should disconnect records', async () => {
      // Create and connect a post
      const post: Post = {
        id: crypto.randomUUID(),
        authorId: userId,
        title: 'Connected Post',
        content: 'Has author',
      };
      postStore.set(post.id, post);

      // Disconnect it
      const response = await app.request(`/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: {
            disconnect: [post.id],
          },
        }),
      });

      expect(response.status).toBe(200);
      const updatedPost = postStore.get(post.id);
      expect(updatedPost?.authorId).toBe(null);
    });
  });
});
