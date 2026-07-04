// Unit tests for `withIncludableRelations` (packages/core/src/relations/
// response-schema.ts) — the helper that adds includable relations to a List/Read
// OpenAPI response item schema so `?include=` shapes are documented + typed.
import type { MetaInput, RelationsConfig } from 'hono-crud';
import { defineModels } from 'hono-crud';
import { withIncludableRelations } from 'hono-crud/internal';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const itemSchema = z.object({ id: z.string(), postId: z.string().nullable() });
const postSchema = z.object({ id: z.string(), title: z.string() });

function metaWith(relations: RelationsConfig | undefined): MetaInput {
  return { model: { tableName: 'comment', schema: itemSchema, primaryKeys: ['id'], relations } };
}

describe('withIncludableRelations', () => {
  it('adds a belongsTo relation as an optional, nullable object', () => {
    const meta = metaWith({
      post: { type: 'belongsTo', model: 'post', foreignKey: 'postId', schema: postSchema },
    });
    const extended = withIncludableRelations(itemSchema, meta, ['post']);

    expect('post' in extended.shape).toBe(true);
    // Optional — parses fine when the relation is absent (not requested).
    expect(extended.parse({ id: 'c1', postId: null })).toEqual({ id: 'c1', postId: null });
    // Nullable — a missing FK / cross-tenant row resolves to null.
    expect(extended.parse({ id: 'c1', postId: null, post: null }).post).toBeNull();
    // Embedded object is kept (not stripped).
    expect(extended.parse({ id: 'c1', postId: 'p1', post: { id: 'p1', title: 'X' } }).post).toEqual(
      { id: 'p1', title: 'X' },
    );
  });

  it('adds a hasMany relation as an optional array', () => {
    const meta = metaWith({
      comments: { type: 'hasMany', model: 'comment', foreignKey: 'postId', schema: postSchema },
    });
    const extended = withIncludableRelations(itemSchema, meta, ['comments']);

    expect(extended.parse({ id: 'c1', postId: null }).comments).toBeUndefined();
    expect(
      extended.parse({ id: 'c1', postId: null, comments: [{ id: 'p1', title: 'X' }] }).comments,
    ).toHaveLength(1);
  });

  it('skips a relation that is not in allowedIncludes', () => {
    const meta = metaWith({
      post: { type: 'belongsTo', model: 'post', foreignKey: 'postId', schema: postSchema },
    });
    const extended = withIncludableRelations(itemSchema, meta, []);
    expect('post' in extended.shape).toBe(false);
    expect(extended).toBe(itemSchema); // no-op → same reference
  });

  it('skips a relation that declares no schema', () => {
    const meta = metaWith({ post: { type: 'belongsTo', model: 'post', foreignKey: 'postId' } });
    const extended = withIncludableRelations(itemSchema, meta, ['post']);
    expect('post' in extended.shape).toBe(false);
    expect(extended).toBe(itemSchema);
  });

  // The raw defineModel path above stays skip-if-absent; the registry path
  // closes the gap — defineModels auto-populates relation.schema from the
  // sibling entry, so the same schema-less authoring now documents the
  // include shape.
  it('includes a schema-less relation once defineModels auto-populates its schema', () => {
    const db = defineModels({
      comments: {
        tableName: 'comment',
        schema: itemSchema,
        primaryKeys: ['id'],
        relations: { post: { type: 'belongsTo', model: 'posts', foreignKey: 'postId' } },
      },
      posts: { tableName: 'post', schema: postSchema, primaryKeys: ['id'] },
    });
    const extended = withIncludableRelations(itemSchema, { model: db.comments }, ['post']);
    expect('post' in extended.shape).toBe(true);
    expect(extended.parse({ id: 'c1', postId: null, post: null }).post).toBeNull();
    expect(
      extended.parse({ id: 'c1', postId: null, post: { id: 'p1', title: 'X' } }).post,
    ).toMatchObject({ id: 'p1' });
  });

  it('returns the item schema unchanged when the model has no relations', () => {
    const extended = withIncludableRelations(itemSchema, metaWith(undefined), ['post']);
    expect(extended).toBe(itemSchema);
  });
});
