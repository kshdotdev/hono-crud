import { MemoryCreateEndpoint, MemoryListEndpoint, clearStorage } from '@hono-crud/memory';
import { Hono } from 'hono';
import { fromHono, registerCrud } from 'hono-crud';
import type { MetaInput, Model, SortSpec } from 'hono-crud';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// Regression: class-based ListEndpoint subclasses must configure sorting via the
// canonical `sortFields` / `defaultSort` fields that the base ListEndpoint reads.
// The old orderBy-flavored alias keys were removed from createList() config in the
// naming sweep; as class fields they were always silently ignored, so any such
// field is dead config.

const ItemSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});

type ItemMeta = MetaInput<typeof ItemSchema>;

const itemMeta: ItemMeta = {
  model: {
    tableName: 'sort_items',
    schema: ItemSchema,
    primaryKeys: ['id'],
  } satisfies Model<typeof ItemSchema>,
};

class ItemCreate extends MemoryCreateEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
}

class ItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
  // Canonical fields that the base ListEndpoint actually reads.
  sortFields = ['name'];
  defaultSort: SortSpec = { field: 'name', order: 'desc' };
}

describe('class-based sort configuration', () => {
  let app: ReturnType<typeof fromHono>;

  beforeEach(async () => {
    clearStorage();
    app = fromHono(new Hono());
    registerCrud(app, '/items', {
      create: ItemCreate as never,
      list: ItemList as never,
    });

    for (const name of ['banana', 'apple', 'cherry']) {
      await app.request('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    }
  });

  it('applies defaultSort when no sort query param is provided', async () => {
    const res = await app.request('/items');
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.result.map((r: { name: string }) => r.name);
    // descending by name → cherry, banana, apple (NOT insertion order)
    expect(names).toEqual(['cherry', 'banana', 'apple']);
  });
});
