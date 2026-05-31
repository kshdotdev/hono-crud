import { MemoryAdapters } from '@hono-crud/memory';
import { defineEndpoints, defineMeta, defineModel, toOpenApiPaths } from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Byte-for-byte OpenAPI snapshot.
//
// This is the safety net for the OpenAPI metadata migration (moving scattered
// `.describe()` / hand-threaded summary/description/tags onto Zod's metadata
// registry): the generated document MUST stay identical. The fixture is
// deliberately metadata-rich — field `.describe()`s, varied field types, and
// per-endpoint `openapi` summary/description/tags — so any change to how
// metadata is attached or emitted shows up in the snapshot diff.
//
// If this snapshot changes, the OpenAPI output changed. Only update the
// snapshot (`vitest -u`) when that change is intended.
// ============================================================================

const ArticleSchema = z.object({
  id: z.uuid().describe('Unique article identifier'),
  title: z.string().min(1).max(200).describe('Article title'),
  slug: z.string().describe('URL-friendly identifier'),
  body: z.string().optional().describe('Article body in Markdown'),
  status: z.enum(['draft', 'published', 'archived']).describe('Publication status'),
  views: z.number().int().nonnegative().default(0).describe('View counter'),
  authorEmail: z.email().describe('Author contact email'),
  published: z.boolean().default(false).describe('Whether the article is live'),
});

const ArticleModel = defineModel({
  tableName: 'articles',
  schema: ArticleSchema,
  primaryKeys: ['id'],
});

const articleMeta = defineMeta({ model: ArticleModel });

function articleEndpoints() {
  return defineEndpoints(
    {
      meta: articleMeta,
      create: {
        openapi: { summary: 'Create an article', tags: ['Articles'] },
      },
      list: {
        openapi: { summary: 'List articles', description: 'Paginated list of articles', tags: ['Articles'] },
        filtering: { fields: ['status', 'slug'] },
        pagination: { defaultPerPage: 20, maxPerPage: 100 },
      },
      read: { openapi: { summary: 'Get an article by id', tags: ['Articles'] } },
      update: { openapi: { summary: 'Update an article', tags: ['Articles'] } },
      delete: { openapi: { summary: 'Delete an article', tags: ['Articles'] } },
      search: { fields: ['title', 'body'] },
      aggregate: {},
      upsert: { conflictTarget: 'slug' },
    },
    MemoryAdapters,
  );
}

describe('OpenAPI output snapshot', () => {
  it('toOpenApiPaths output is stable (byte-for-byte regression guard)', () => {
    const paths = toOpenApiPaths(articleEndpoints());
    expect(paths).toMatchSnapshot();
  });
});
