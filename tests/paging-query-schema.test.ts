import { MemoryExportEndpoint, MemoryListEndpoint, MemorySearchEndpoint } from '@hono-crud/memory';
import { Hono } from 'hono';
import { fromHono, registerCrud } from 'hono-crud';
import type { MetaInput, Model, SortSpec } from 'hono-crud';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// The list query params a generated client reads from the OpenAPI document:
// paging carries its type, bounds and defaults, so no client restates them.

const ItemSchema = z.object({ id: z.uuid(), name: z.string() });
type ItemMeta = MetaInput<typeof ItemSchema>;
const itemMeta: ItemMeta = {
  model: {
    tableName: 'paging_items',
    schema: ItemSchema,
    primaryKeys: ['id'],
  } satisfies Model<typeof ItemSchema>,
};

class ItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override defaultPerPage = 25;
  protected override maxPerPage = 50;
}
class CappedItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override maxPerPage = 10;
}
class SortedItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override sortFields = ['name', 'id'];
  protected override defaultSort: SortSpec = { field: 'name', order: 'desc' };
}
class UnsortedDefaultList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override sortFields = ['name'];
}
class CursorItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override cursorPaginationEnabled = true;
  protected override maxPerPage = 40;
}
class ItemSearch extends MemorySearchEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  protected override searchFields = ['name'];
  protected override defaultPerPage = 10;
  protected override maxPerPage = 30;
}
class ItemExport extends MemoryExportEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
}

interface Parameter {
  name: string;
  in: string;
  schema: Record<string, unknown>;
}
interface OpenApiDocument {
  paths: Record<string, { get?: { parameters?: Parameter[] } }>;
}

let document: OpenApiDocument;

const queryParam = (path: string, name: string) =>
  document.paths[path]?.get?.parameters?.find((p) => p.in === 'query' && p.name === name)?.schema;

beforeAll(async () => {
  const app = fromHono(new Hono());
  registerCrud(app, '/items', {
    list: ItemList as never,
    search: ItemSearch as never,
    export: ItemExport as never,
  });
  registerCrud(app, '/capped-items', { list: CappedItemList as never });
  registerCrud(app, '/sorted-items', { list: SortedItemList as never });
  registerCrud(app, '/unsorted-items', { list: UnsortedDefaultList as never });
  registerCrud(app, '/cursor-items', { list: CursorItemList as never });
  app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'paging', version: '1.0.0' } });
  document = (await (await app.request('/openapi.json')).json()) as OpenApiDocument;
});

describe('list query schema', () => {
  it('declares page as an integer from 1, defaulting to 1', () => {
    expect(queryParam('/items', 'page')).toEqual({ type: 'integer', minimum: 1, default: 1 });
  });

  it('declares per_page with the endpoint default page size and ceiling', () => {
    expect(queryParam('/items', 'per_page')).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: 25,
    });
  });

  it('caps the per_page default at a ceiling below defaultPerPage', () => {
    expect(queryParam('/capped-items', 'per_page')).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 10,
      default: 10,
    });
  });

  it('leaves page and per_page out of the export query', () => {
    expect(queryParam('/items/export', 'page')).toBeUndefined();
    expect(queryParam('/items/export', 'per_page')).toBeUndefined();
  });
});

describe('search query schema', () => {
  it('declares page and per_page with the search endpoint bounds and defaults', () => {
    expect(queryParam('/items/search', 'page')).toEqual({
      type: 'integer',
      minimum: 1,
      default: 1,
    });
    expect(queryParam('/items/search', 'per_page')).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 30,
      default: 10,
    });
  });
});

describe('cursor query schema', () => {
  it('declares limit as a bounded integer with no default', () => {
    expect(queryParam('/cursor-items', 'limit')).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 40,
      description: 'Number of items to return (cursor pagination)',
    });
  });
});

describe('sort query schema', () => {
  it('declares defaultSort as the sort and order defaults', () => {
    expect(queryParam('/sorted-items', 'sort')).toEqual({
      type: 'string',
      enum: ['name', 'id'],
      default: 'name',
      description: 'Field to sort by',
    });
    expect(queryParam('/sorted-items', 'order')).toEqual({
      type: 'string',
      enum: ['asc', 'desc'],
      default: 'desc',
      description: 'Sort direction (asc or desc)',
    });
  });

  it('declares no sort default without defaultSort, and order defaults to asc', () => {
    expect(queryParam('/unsorted-items', 'sort')).not.toHaveProperty('default');
    expect(queryParam('/unsorted-items', 'order')).toMatchObject({ default: 'asc' });
  });
});
