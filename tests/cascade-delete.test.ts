/**
 * Tests for Cascade Delete functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
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

const PostSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid().nullable(),
  title: z.string(),
  content: z.string(),
});

const CommentSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  authorName: z.string(),
  content: z.string(),
});

const ProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  bio: z.string(),
});

type User = z.infer<typeof UserSchema>;
type Post = z.infer<typeof PostSchema>;
type Comment = z.infer<typeof CommentSchema>;
type Profile = z.infer<typeof ProfileSchema>;

// ============================================================================
// Model Definitions with Cascade Configuration
// ============================================================================

// User with cascade delete for posts and profile
const UserModelCascade = defineModel({
  tableName: 'users_cascade',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts_cascade',
      foreignKey: 'authorId',
      cascade: { onDelete: 'cascade' },
    },
    profile: {
      type: 'hasOne',
      model: 'profiles_cascade',
      foreignKey: 'userId',
      cascade: { onDelete: 'cascade' },
    },
  },
});

// User with setNull for posts
const UserModelSetNull = defineModel({
  tableName: 'users_setnull',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts_setnull',
      foreignKey: 'authorId',
      cascade: { onDelete: 'setNull' },
    },
  },
});

// User with restrict (cannot delete if has posts)
const UserModelRestrict = defineModel({
  tableName: 'users_restrict',
  schema: UserSchema,
  primaryKeys: ['id'],
  relations: {
    posts: {
      type: 'hasMany',
      model: 'posts_restrict',
      foreignKey: 'authorId',
      cascade: { onDelete: 'restrict' },
    },
  },
});

// Post with cascade for comments
const PostModelCascade = defineModel({
  tableName: 'posts_cascade',
  schema: PostSchema,
  primaryKeys: ['id'],
  relations: {
    comments: {
      type: 'hasMany',
      model: 'comments',
      foreignKey: 'postId',
      cascade: { onDelete: 'cascade' },
    },
  },
});

const userCascadeMeta = defineMeta({ model: UserModelCascade });
const userSetNullMeta = defineMeta({ model: UserModelSetNull });
const userRestrictMeta = defineMeta({ model: UserModelRestrict });
const postCascadeMeta = defineMeta({ model: PostModelCascade });

// ============================================================================
// Endpoints
// ============================================================================

class UserCascadeCreate extends MemoryCreateEndpoint {
  _meta = userCascadeMeta;
}

class UserCascadeDelete extends MemoryDeleteEndpoint {
  _meta = userCascadeMeta;
  includeCascadeResults = true;
}

class UserSetNullCreate extends MemoryCreateEndpoint {
  _meta = userSetNullMeta;
}

class UserSetNullDelete extends MemoryDeleteEndpoint {
  _meta = userSetNullMeta;
  includeCascadeResults = true;
}

class UserRestrictCreate extends MemoryCreateEndpoint {
  _meta = userRestrictMeta;
}

class UserRestrictDelete extends MemoryDeleteEndpoint {
  _meta = userRestrictMeta;
}

class PostCascadeDelete extends MemoryDeleteEndpoint {
  _meta = postCascadeMeta;
  includeCascadeResults = true;
}

// ============================================================================
// Tests
// ============================================================================

describe('Cascade Delete', () => {
  let app: ReturnType<typeof fromHono>;
  let userCascadeStore: Map<string, User>;
  let postCascadeStore: Map<string, Post>;
  let profileCascadeStore: Map<string, Profile>;
  let commentStore: Map<string, Comment>;
  let userSetNullStore: Map<string, User>;
  let postSetNullStore: Map<string, Post>;
  let userRestrictStore: Map<string, User>;
  let postRestrictStore: Map<string, Post>;

  beforeEach(() => {
    clearStorage();
    userCascadeStore = getStorage<User>('users_cascade');
    postCascadeStore = getStorage<Post>('posts_cascade');
    profileCascadeStore = getStorage<Profile>('profiles_cascade');
    commentStore = getStorage<Comment>('comments');
    userSetNullStore = getStorage<User>('users_setnull');
    postSetNullStore = getStorage<Post>('posts_setnull');
    userRestrictStore = getStorage<User>('users_restrict');
    postRestrictStore = getStorage<Post>('posts_restrict');

    app = fromHono(new Hono());
    app.post('/users-cascade', UserCascadeCreate);
    app.delete('/users-cascade/:id', UserCascadeDelete);
    app.post('/users-setnull', UserSetNullCreate);
    app.delete('/users-setnull/:id', UserSetNullDelete);
    app.post('/users-restrict', UserRestrictCreate);
    app.delete('/users-restrict/:id', UserRestrictDelete);
    app.delete('/posts-cascade/:id', PostCascadeDelete);
  });

  describe('cascade action', () => {
    it('should delete related records when parent is deleted', async () => {
      // Create user
      const userRes = await app.request('/users-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
      });
      const user = (await userRes.json() as { result: User }).result;

      // Create posts for user
      const post1: Post = { id: crypto.randomUUID(), authorId: user.id, title: 'Post 1', content: 'Content 1' };
      const post2: Post = { id: crypto.randomUUID(), authorId: user.id, title: 'Post 2', content: 'Content 2' };
      postCascadeStore.set(post1.id, post1);
      postCascadeStore.set(post2.id, post2);

      // Create profile for user
      const profile: Profile = { id: crypto.randomUUID(), userId: user.id, bio: 'Alice bio' };
      profileCascadeStore.set(profile.id, profile);

      expect(userCascadeStore.size).toBe(1);
      expect(postCascadeStore.size).toBe(2);
      expect(profileCascadeStore.size).toBe(1);

      // Delete user - should cascade
      const deleteRes = await app.request(`/users-cascade/${user.id}`, { method: 'DELETE' });
      const deleteResult = await deleteRes.json() as { result: { cascade?: { deleted?: { posts?: number; profile?: number } } } };

      expect(deleteRes.status).toBe(200);
      expect(userCascadeStore.size).toBe(0);
      expect(postCascadeStore.size).toBe(0);
      expect(profileCascadeStore.size).toBe(0);
      expect(deleteResult.result.cascade?.deleted?.posts).toBe(2);
      expect(deleteResult.result.cascade?.deleted?.profile).toBe(1);
    });
  });

  describe('setNull action', () => {
    it('should set foreign key to null when parent is deleted', async () => {
      // Create user
      const userRes = await app.request('/users-setnull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
      });
      const user = (await userRes.json() as { result: User }).result;

      // Create posts for user
      const post1: Post = { id: crypto.randomUUID(), authorId: user.id, title: 'Post 1', content: 'Content 1' };
      const post2: Post = { id: crypto.randomUUID(), authorId: user.id, title: 'Post 2', content: 'Content 2' };
      postSetNullStore.set(post1.id, post1);
      postSetNullStore.set(post2.id, post2);

      expect([...postSetNullStore.values()].every(p => p.authorId === user.id)).toBe(true);

      // Delete user - should setNull
      const deleteRes = await app.request(`/users-setnull/${user.id}`, { method: 'DELETE' });
      const deleteResult = await deleteRes.json() as { result: { cascade?: { nullified?: { posts?: number } } } };

      expect(deleteRes.status).toBe(200);
      expect(userSetNullStore.size).toBe(0);
      expect(postSetNullStore.size).toBe(2); // Posts still exist
      expect([...postSetNullStore.values()].every(p => p.authorId === null)).toBe(true);
      expect(deleteResult.result.cascade?.nullified?.posts).toBe(2);
    });
  });

  describe('restrict action', () => {
    it('should prevent delete when related records exist', async () => {
      // Create user
      const userRes = await app.request('/users-restrict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
      });
      const user = (await userRes.json() as { result: User }).result;

      // Create post for user
      const post: Post = { id: crypto.randomUUID(), authorId: user.id, title: 'Post', content: 'Content' };
      postRestrictStore.set(post.id, post);

      // Try to delete user - should fail
      const deleteRes = await app.request(`/users-restrict/${user.id}`, { method: 'DELETE' });
      const deleteResult = await deleteRes.json() as { error?: { details?: { relation?: string } } };

      expect(deleteRes.status).toBe(409);
      expect(userRestrictStore.size).toBe(1); // User NOT deleted
      expect(postRestrictStore.size).toBe(1); // Post still exists
      expect(deleteResult.error?.details?.relation).toBe('posts');
    });

    it('should allow delete when no related records exist', async () => {
      // Create user
      const userRes = await app.request('/users-restrict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
      });
      const user = (await userRes.json() as { result: User }).result;

      // Delete without any posts
      const deleteRes = await app.request(`/users-restrict/${user.id}`, { method: 'DELETE' });

      expect(deleteRes.status).toBe(200);
      expect(userRestrictStore.size).toBe(0);
    });
  });

  describe('nested cascade', () => {
    it('should cascade delete through multiple levels', async () => {
      // Create a post with comments
      const post: Post = { id: crypto.randomUUID(), authorId: null, title: 'Post', content: 'Content' };
      postCascadeStore.set(post.id, post);

      const comment1: Comment = { id: crypto.randomUUID(), postId: post.id, authorName: 'Commenter 1', content: 'Great post!' };
      const comment2: Comment = { id: crypto.randomUUID(), postId: post.id, authorName: 'Commenter 2', content: 'Thanks!' };
      commentStore.set(comment1.id, comment1);
      commentStore.set(comment2.id, comment2);

      expect(postCascadeStore.size).toBe(1);
      expect(commentStore.size).toBe(2);

      // Delete post - should cascade to comments
      const deleteRes = await app.request(`/posts-cascade/${post.id}`, { method: 'DELETE' });

      expect(deleteRes.status).toBe(200);
      expect(postCascadeStore.size).toBe(0);
      expect(commentStore.size).toBe(0);
    });
  });
});
