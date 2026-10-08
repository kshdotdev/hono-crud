// Unit tests for `withIncludableRelations` (packages/core/src/relations/
// response-schema.ts) — the helper that adds includable relations to a
// List/Read/Search/Export OpenAPI response item schema so `?include=` shapes
// are documented + typed.
import { createRequire } from 'node:module';
import {
  MemoryCreateEndpoint,
  MemoryExportEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemorySearchEndpoint,
} from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MetaInput, RelationsConfig } from 'hono-crud';
import { defineMeta, defineModel, defineModels, fromHono } from 'hono-crud';
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

// OpenAPI emission through the real registration path. Named (`.meta({ id })`)
// schemas must keep their component `$ref` on every verb, and a to-one
// relation must never leak nullability into the shared component.
describe('withIncludableRelations OpenAPI emission', () => {
  type Schema = Record<string, unknown>;
  type Doc = {
    components?: { schemas?: Record<string, Schema> };
    paths: Record<string, Record<string, { responses: Record<string, Schema> }>>;
  };

  const PostRow = z.object({ id: z.string(), title: z.string() }).meta({ id: 'IncludePost' });
  const CommentRow = z
    .object({ id: z.string(), postId: z.string().nullable() })
    .meta({ id: 'IncludeComment' });
  const commentMeta = defineMeta({
    model: defineModel({
      tableName: 'include_comments',
      schema: CommentRow,
      primaryKeys: ['id'],
      relations: {
        post: { type: 'belongsTo', model: 'posts', foreignKey: 'postId', schema: PostRow },
      },
    }),
  });
  const postMeta = defineMeta({
    model: defineModel({ tableName: 'include_posts', schema: PostRow, primaryKeys: ['id'] }),
  });

  class CommentCreate extends MemoryCreateEndpoint {
    _meta = commentMeta;
  }
  class CommentList extends MemoryListEndpoint {
    _meta = commentMeta;
    allowedIncludes = ['post'];
  }
  class CommentRead extends MemoryReadEndpoint {
    _meta = commentMeta;
    allowedIncludes = ['post'];
  }
  class CommentSearch extends MemorySearchEndpoint {
    _meta = commentMeta;
    allowedIncludes = ['post'];
  }
  class CommentExport extends MemoryExportEndpoint {
    _meta = commentMeta;
    allowedIncludes = ['post'];
  }
  class PostRead extends MemoryReadEndpoint {
    _meta = postMeta;
  }

  async function emit(openapi: '3.0.0' | '3.1.0'): Promise<Doc> {
    const app = fromHono(new OpenAPIHono());
    // Relation routes first: the related schema's first use is the to-one include.
    app.get('/comments', CommentList);
    app.get('/comments/search', CommentSearch);
    app.get('/comments/export', CommentExport);
    app.get('/comments/:id', CommentRead);
    app.post('/comments', CommentCreate);
    app.get('/posts/:id', PostRead);
    const config = { openapi, info: { title: 't', version: '1' } };
    // `.doc()` runs the 3.0 generator whatever `openapi` says; `.doc31()` is the 3.1 one.
    if (openapi === '3.0.0') app.doc('/openapi.json', config);
    else app.doc31('/openapi.json', config);
    return (await app.request('/openapi.json')).json() as Promise<Doc>;
  }

  const result = (doc: Doc, path: string, method: string): Schema => {
    const responses = doc.paths[path]?.[method]?.responses ?? {};
    const response = (responses['200'] ?? responses['201']) as {
      content: { 'application/json': { schema: { properties: { result: Schema } } } };
    };
    return response.content['application/json'].schema.properties.result;
  };

  const extendsComment = (schema: Schema) =>
    expect(schema.allOf).toEqual([
      { $ref: '#/components/schemas/IncludeComment' },
      expect.objectContaining({ properties: { post: expect.any(Object) } }),
    ]);

  // One response schema through the 3.0 or 3.1 generator.
  const emitItem = (item: z.ZodType, openapi: '3.0.0' | '3.1.0' = '3.1.0'): Schema => {
    const app = new OpenAPIHono();
    app.openAPIRegistry.registerPath({
      method: 'get',
      path: '/item',
      responses: {
        200: { description: 'item', content: { 'application/json': { schema: item } } },
      },
    });
    const config = { openapi, info: { title: 't', version: '1' } };
    const doc =
      openapi === '3.0.0' ? app.getOpenAPIDocument(config) : app.getOpenAPI31Document(config);
    const responses = doc.paths?.['/item']?.get?.responses as Record<string, Schema>;
    return (responses['200'] as { content: { 'application/json': { schema: Schema } } }).content[
      'application/json'
    ].schema;
  };

  for (const openapi of ['3.0.0', '3.1.0'] as const) {
    it(`keeps the item $ref on list, read, search and export (${openapi})`, async () => {
      const doc = await emit(openapi);
      expect(result(doc, '/comments', 'post')).toEqual({
        $ref: '#/components/schemas/IncludeComment',
      });
      extendsComment(result(doc, '/comments', 'get').items as Schema);
      extendsComment(result(doc, '/comments/{id}', 'get'));
      const searchItem = (result(doc, '/comments/search', 'get').items as Schema)
        .properties as Record<string, Schema>;
      extendsComment(searchItem.item as Schema);
      const exportData = (
        result(doc, '/comments/export', 'get').properties as Record<string, Schema>
      ).data as Schema;
      extendsComment(exportData.items as Schema);
    });

    it(`keeps a to-one relation nullable without touching its component (${openapi})`, async () => {
      const doc = await emit(openapi);
      const post = doc.components?.schemas?.IncludePost ?? {};
      expect(post).not.toHaveProperty('nullable');
      expect(post.type).toBe('object');
      expect(result(doc, '/posts/{id}', 'get')).toEqual({
        $ref: '#/components/schemas/IncludePost',
      });
      const relations = (result(doc, '/comments/{id}', 'get').allOf as Schema[])[1] as {
        properties: { post: Schema };
      };
      expect(relations.properties.post).toEqual({
        anyOf: [
          { $ref: '#/components/schemas/IncludePost' },
          openapi === '3.0.0' ? { nullable: true } : { type: 'null' },
        ],
      });
    });

    // Only a named schema needs the union: the 3.0 generator's bare
    // `{ nullable: true }` null branch types as `unknown` in generated clients.
    it(`keeps an unnamed to-one relation an exact nullable object (${openapi})`, () => {
      const meta = metaWith({
        post: { type: 'belongsTo', model: 'post', foreignKey: 'postId', schema: postSchema },
      });
      const item = emitItem(withIncludableRelations(itemSchema, meta, ['post']), openapi);
      expect((item.properties as Record<string, Schema>).post).toMatchObject(
        openapi === '3.0.0' ? { type: 'object', nullable: true } : { type: ['object', 'null'] },
      );
    });
  }

  // `getSchema()` runs on every request (getValidatedData), and each
  // `.openapi(id)` / `.extend()` pins a new entry in zod-to-openapi's strong
  // registry, so a fresh schema per call is a leak.
  it('documents the same item schema on every getSchema() call', () => {
    const read = new CommentRead();
    const item = (schema: { responses?: Record<number, unknown> }) => {
      const ok = schema.responses?.[200] as {
        content: { 'application/json': { schema: z.ZodObject } };
      };
      return ok.content['application/json'].schema.shape.result;
    };
    expect(item(read.getSchema())).toBe(item(read.getSchema()));
  });

  it('stays one flat object in Zod JSON Schema (MCP outputSchema)', () => {
    const item = withIncludableRelations(CommentRow, commentMeta, ['post']);
    const json = z.toJSONSchema(item, { io: 'output' }) as Schema;
    expect(json).not.toHaveProperty('allOf');
    expect(Object.keys(json.properties as Schema)).toEqual(['id', 'postId', 'post']);
    expect(item.parse({ id: 'c1', postId: 'p1', post: { id: 'p1', title: 'X' } }).post).toEqual({
      id: 'p1',
      title: 'X',
    });
  });

  // Rows the allOf form cannot carry soundly keep the pre-#150 inline shape.
  const inlinesWithPost = (item: z.ZodObject) => {
    const schema = emitItem(withIncludableRelations(item, commentMeta, ['post']));
    expect(schema).not.toHaveProperty('allOf');
    expect(Object.keys(schema.properties as Schema)).toEqual(['id', 'post']);
  };

  it('inlines a strict or typed-catchall row, whose component would reject the relations', () => {
    inlinesWithPost(z.strictObject({ id: z.string() }).meta({ id: 'IncludeStrictRow' }));
    inlinesWithPost(
      z.object({ id: z.string() }).catchall(z.string()).meta({ id: 'IncludeCatchallRow' }),
    );
  });

  // allOf intersects a row field with the relation of the same name
  // (`post: string & (Post | null)`), which no row satisfies.
  it('inlines a row whose field shares a relation name', () => {
    inlinesWithPost(
      z.object({ id: z.string(), post: z.string() }).meta({ id: 'IncludeShadowRow' }),
    );
  });

  it('keeps the $ref on a loose row, whose component accepts the relations', () => {
    const row = z.looseObject({ id: z.string() }).meta({ id: 'IncludeLooseRow' });
    const schema = emitItem(withIncludableRelations(row, commentMeta, ['post']));
    expect(schema.allOf).toEqual([
      { $ref: '#/components/schemas/IncludeLooseRow' },
      expect.objectContaining({ properties: { post: expect.any(Object) } }),
    ]);
  });

  it('inlines a row built on a Zod copy @hono/zod-openapi did not extend', () => {
    // The CommonJS build is a second Zod instance: its schemas have no `.openapi`.
    const otherZod = createRequire(import.meta.url)('zod') as typeof z;
    const row = otherZod.object({ id: otherZod.string() }).meta({ id: 'IncludeOtherZodRow' });
    expect('openapi' in row).toBe(false);
    inlinesWithPost(row);
  });
});
