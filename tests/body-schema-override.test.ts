import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, registerCrud, defineEndpoints, MemoryAdapters, defineMeta, defineModel } from '../src/index.js';
import { clearStorage } from '../src/adapters/memory/index.js';

const PostSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  authorId: z.string(),
  internalNotes: z.string().optional(),
});

const PostModel = defineModel({
  tableName: 'posts_body_schema',
  schema: PostSchema,
  primaryKeys: ['id'],
});

const postMeta = defineMeta({ model: PostModel });

describe('per-endpoint bodySchema override', () => {
  beforeEach(() => clearStorage());

  describe('CreateEndpointConfig.bodySchema', () => {
    it('uses the override schema instead of the model-derived one', async () => {
      // The override schema demands a `slug` field that the model does not have,
      // and forbids the `internalNotes` field that the model permits. This
      // proves the override schema replaces (not extends) the default.
      const CreatePostInput = z.object({
        title: z.string().min(5),
        body: z.string(),
        authorId: z.string(),
        slug: z.string().regex(/^[a-z0-9-]+$/),
      });

      const endpoints = defineEndpoints(
        {
          meta: postMeta,
          create: { bodySchema: CreatePostInput as never },
          list: {},
        },
        MemoryAdapters,
      );

      const app = fromHono(new Hono());
      registerCrud(app, '/posts', endpoints);

      // Missing `slug` — model schema would have allowed this; override rejects it.
      const r1 = await app.request('/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hello world', body: 'b', authorId: 'u1' }),
      });
      expect(r1.status).toBe(400);

      // Title too short — override demands min(5).
      const r2 = await app.request('/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hi', body: 'b', authorId: 'u1', slug: 'hi' }),
      });
      expect(r2.status).toBe(400);

      // All required override fields present.
      const r3 = await app.request('/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Hello world',
          body: 'b',
          authorId: 'u1',
          slug: 'hello-world',
        }),
      });
      expect(r3.status).toBe(201);
    });

    it('falls back to the model-derived schema when no override is set', async () => {
      const endpoints = defineEndpoints(
        { meta: postMeta, create: {} },
        MemoryAdapters,
      );

      const app = fromHono(new Hono());
      registerCrud(app, '/posts2', endpoints);

      // Missing `body` — required by the model schema.
      const r = await app.request('/posts2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hi', authorId: 'u1' }),
      });
      expect(r.status).toBe(400);
    });
  });

  describe('UpdateEndpointConfig.bodySchema', () => {
    it('uses the override schema and is not auto-partialed', async () => {
      // Pre-seed an item via create to update later.
      const seedEndpoints = defineEndpoints(
        { meta: postMeta, create: {} },
        MemoryAdapters,
      );
      const seedApp = fromHono(new Hono());
      registerCrud(seedApp, '/posts3', seedEndpoints);
      const created = await seedApp.request('/posts3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Original', body: 'b', authorId: 'u1' }),
      });
      const id = ((await created.json()) as { result: { id: string } }).result.id;

      // The override demands BOTH title and body — no `.partial()` applied.
      const UpdatePostInput = z.object({
        title: z.string().min(1),
        body: z.string().min(1),
      });

      const updEndpoints = defineEndpoints(
        {
          meta: postMeta,
          update: { bodySchema: UpdatePostInput as never },
        },
        MemoryAdapters,
      );
      const updApp = fromHono(new Hono());
      registerCrud(updApp, '/posts3', updEndpoints);

      // Only `title` provided — fails because override requires `body` too.
      const r1 = await updApp.request(`/posts3/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      });
      expect(r1.status).toBe(400);

      // Both fields → succeeds.
      const r2 = await updApp.request(`/posts3/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New title', body: 'New body' }),
      });
      expect(r2.status).toBe(200);
    });

    it('falls back to the model-derived partial schema when no override is set', async () => {
      const endpoints = defineEndpoints(
        { meta: postMeta, create: {}, update: {} },
        MemoryAdapters,
      );
      const app = fromHono(new Hono());
      registerCrud(app, '/posts4', endpoints);

      const created = await app.request('/posts4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'X', body: 'y', authorId: 'u1' }),
      });
      const id = ((await created.json()) as { result: { id: string } }).result.id;

      // Default update schema is partial — single-field PATCH succeeds.
      const r = await app.request(`/posts4/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'updated' }),
      });
      expect(r.status).toBe(200);
    });
  });
});
