/**
 * Filter query params are typed from the model field: single-value operators
 * (`eq`/`ne`/`gt`/...) on a string enum field document (and validate) the
 * members, while comma-list, substring, and `null` operators stay plain
 * strings. The enum is rebuilt from its members, so the field's default,
 * description, and component id stay off the param — a leaked `.default()`
 * would filter every request that omits it.
 */
import { clearStorage, createMemoryCrud } from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z
    .enum(['draft', 'published'])
    .default('draft')
    .describe('Publication status')
    .meta({ id: 'NoteStatus' }),
  kind: z.literal('note').default('note'),
});

const noteMeta = defineMeta({
  model: defineModel({ tableName: 'filter_param_notes', schema: NoteSchema, primaryKeys: ['id'] }),
});
const Notes = createMemoryCrud(noteMeta);

const FILTER_CONFIG = { status: ['ne', 'gt', 'in', 'like', 'null'] as const };

class NoteList extends Notes.List {
  filterFields = ['kind'];
  filterConfig = FILTER_CONFIG;
}

class NoteSearch extends Notes.Search {
  searchFields = ['title'];
  filterConfig = FILTER_CONFIG;
}

class NoteExport extends Notes.Export {
  filterConfig = FILTER_CONFIG;
}

function buildApp() {
  const app = fromHono(new OpenAPIHono());
  registerCrud(app, '/notes', {
    create: Notes.Create,
    list: NoteList,
    search: NoteSearch,
    export: NoteExport,
  });
  return app;
}

type Param = { name: string; in: string; schema: unknown };
type DocShape = { paths: Record<string, { get?: { parameters?: Param[] } }> };

function filterParams(doc: DocShape, path: string): Record<string, unknown> {
  const params = doc.paths[path]?.get?.parameters ?? [];
  return Object.fromEntries(
    params.filter((p) => /^(status|kind)/.test(p.name)).map((p) => [p.name, p.schema]),
  );
}

const STATUS_ENUM = { type: 'string', enum: ['draft', 'published'] };
const EXPECTED = {
  status: STATUS_ENUM,
  'status[ne]': STATUS_ENUM,
  'status[gt]': STATUS_ENUM,
  'status[in]': { type: 'string' },
  'status[like]': { type: 'string' },
  'status[null]': { type: 'string' },
};

describe('filter params typed from the model field', () => {
  const info = { openapi: '3.0.0', info: { title: 't', version: '1' } };

  it('documents enum members on single-value operators in both the 3.0 and 3.1 documents', () => {
    const app = buildApp();
    const docs = [
      app.getOpenAPIDocument(info) as unknown as DocShape,
      app.getOpenAPI31Document({ ...info, openapi: '3.1.0' }) as unknown as DocShape,
    ];
    for (const doc of docs) {
      expect(filterParams(doc, '/notes')).toEqual({
        ...EXPECTED,
        kind: { type: 'string', enum: ['note'] },
      });
      expect(filterParams(doc, '/notes/search')).toEqual(EXPECTED);
      expect(filterParams(doc, '/notes/export')).toEqual(EXPECTED);
    }
  });

  describe('requests', () => {
    const app = buildApp();

    beforeEach(async () => {
      clearStorage();
      for (const note of [
        { title: 'a', status: 'draft' },
        { title: 'b', status: 'published' },
      ]) {
        const res = await app.request('/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note),
        });
        expect(res.status).toBe(201);
      }
    });

    it('never applies the field default as a filter', async () => {
      const res = await app.request('/notes');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { result: unknown[] }).result).toHaveLength(2);
    });

    it('rejects a typo at the validator with the standard 400 envelope', async () => {
      for (const path of [
        '/notes?status=publised',
        '/notes?status[gt]=publised',
        '/notes/search?q=a&status[ne]=publised',
        '/notes/export?status=publised',
      ]) {
        const res = await app.request(path);
        expect(res.status, path).toBe(400);
        const body = (await res.json()) as { success: boolean; error: { code: string } };
        expect(body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      }
    });
  });
});
