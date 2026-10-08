import {
  MemoryExportEndpoint,
  MemoryListEndpoint,
  MemoryVersionHistoryEndpoint,
  getStore,
} from '@hono-crud/memory';
import { Hono } from 'hono';
import { InputValidationException, fromHono, parseListFilters, registerCrud } from 'hono-crud';
import type { MetaInput, Model } from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// `parseListFilters` parses paging through the same schema the endpoint
// documents, so an endpoint mounted without the route validator (raw query
// strings) gets the bounds, defaults and 400s a registered one gets.

describe('parseListFilters paging', () => {
  it('coerces raw strings and applies the paging defaults', () => {
    expect(parseListFilters({}, {}).options).toMatchObject({ page: 1, per_page: 20 });
    expect(parseListFilters({ page: '3', per_page: '7' }, {}).options).toMatchObject({
      page: 3,
      per_page: 7,
    });
    expect(parseListFilters({}, { defaultPerPage: 5 }).options.per_page).toBe(5);
  });

  it('caps the per_page default at maxPerPage', () => {
    expect(parseListFilters({}, { maxPerPage: 10 }).options.per_page).toBe(10);
  });

  it('accepts already-validated numbers unchanged', () => {
    expect(parseListFilters({ page: 2, per_page: 50 }, {}).options).toMatchObject({
      page: 2,
      per_page: 50,
    });
  });

  it('refuses out-of-range and non-integer paging instead of clamping', () => {
    for (const query of [
      { per_page: '101' },
      { per_page: '0' },
      { per_page: 'abc' },
      { per_page: '' },
      { page: '0' },
      { page: '2.5' },
    ]) {
      expect(() => parseListFilters(query, {})).toThrow(InputValidationException);
    }
    expect(() => parseListFilters({ per_page: '30' }, { maxPerPage: 25 })).toThrow(
      InputValidationException,
    );
  });

  it('reports the offending param in the validation details', () => {
    try {
      parseListFilters({ per_page: '500' }, {});
      expect.unreachable();
    } catch (error) {
      expect((error as InputValidationException).details).toEqual([
        expect.objectContaining({ path: 'per_page' }),
      ]);
    }
  });

  it('passes a filter named like an Object.prototype member through as a filter', () => {
    const { filters } = parseListFilters(
      { constructor: 'a', valueOf: 'b' },
      { filterFields: ['constructor', 'valueOf'] },
    );
    expect(filters.map((f) => f.field)).toEqual(['constructor', 'valueOf']);
  });

  it('bounds the cursor limit only when cursor pagination is enabled, with no default', () => {
    const cursor = { cursorPaginationEnabled: true, maxPerPage: 40 };
    expect(parseListFilters({}, cursor).options.limit).toBeUndefined();
    expect(parseListFilters({ limit: '10' }, cursor).options.limit).toBe(10);
    expect(() => parseListFilters({ limit: '41' }, cursor)).toThrow(InputValidationException);

    // Without cursor pagination, `limit` is not a paging param at all.
    expect(parseListFilters({ limit: 'abc' }, {}).options.limit).toBeUndefined();
  });
});

const ItemSchema = z.object({ id: z.uuid(), name: z.string() });
type ItemMeta = MetaInput<typeof ItemSchema>;
const itemMeta: ItemMeta = {
  model: {
    tableName: 'bare_paging_items',
    schema: ItemSchema,
    primaryKeys: ['id'],
  } satisfies Model<typeof ItemSchema>,
};

class BareItemList extends MemoryListEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
}

describe('list endpoint mounted without the route validator', () => {
  const app = new Hono();
  app.get('/items', async (c) => {
    const endpoint = new BareItemList();
    endpoint.setContext(c as never);
    return endpoint.handle();
  });

  it('refuses per_page over the ceiling like a registered endpoint', async () => {
    const response = await app.request('/items?per_page=500');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('pages with raw query strings in range', async () => {
    const response = await app.request('/items?page=2&per_page=5');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result_info: { page: number; per_page: number } };
    expect(body.result_info).toMatchObject({ page: 2, per_page: 5 });
  });
});

class BareItemExport extends MemoryExportEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
}

describe('export endpoint mounted without the route validator', () => {
  const app = new Hono();
  app.get('/items/export', async (c) => {
    const endpoint = new BareItemExport();
    endpoint.setContext(c as never);
    return endpoint.handle();
  });

  it('neither honors nor validates page/per_page, like a registered export', async () => {
    const store = getStore<Record<string, unknown>>('bare_paging_items');
    store.clear();
    for (const name of ['a', 'b', 'c']) {
      const id = crypto.randomUUID();
      store.set(id, { id, name });
    }

    const response = await app.request('/items/export?per_page=1&page=0');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { count: number } };
    expect(body.result.count).toBe(3);
  });
});

class NoPagingQueryExport extends BareItemExport {
  protected override getQuerySchema() {
    return z.object({ name: z.string().optional() });
  }
}

describe('export endpoint whose query schema has no paging params', () => {
  it('exports instead of failing on the missing page/per_page keys', async () => {
    const app = fromHono(new Hono());
    registerCrud(app, '/items', { export: NoPagingQueryExport as never });
    const response = await app.request('/items/export');
    expect(response.status).toBe(200);
  });
});

class ItemVersions extends MemoryVersionHistoryEndpoint<Record<string, never>, ItemMeta> {
  _meta = itemMeta;
}

describe('version history query schema', () => {
  it('declares limit as an integer from 1 up to maxLimit', () => {
    const query = new ItemVersions().getSchema().request?.query as z.ZodObject;
    expect(z.toJSONSchema(query.shape.limit, { io: 'input' })).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
    });
  });

  it('refuses fractional limit and offset on a mounted route', async () => {
    class VersionedItemVersions extends ItemVersions {
      _meta = { model: { ...itemMeta.model, versioning: true } };
    }
    const app = fromHono(new Hono());
    registerCrud(app, '/items', { versionHistory: VersionedItemVersions as never });
    for (const query of ['limit=2.5', 'offset=2.5']) {
      const response = await app.request(`/items/${crypto.randomUUID()}/versions?${query}`);
      expect(response.status, query).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code, query).toBe('VALIDATION_ERROR');
    }
  });
});
