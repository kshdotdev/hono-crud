/**
 * Tests for three abstract-layer fixes on SearchEndpoint (v0.12.3 audit):
 *
 *   1. Zod-version-agnostic searchable-field auto-detection.
 *      v0.12.3 only inspected `_def.typeName === 'ZodString'` (Zod 3
 *      internal shape). Zod 4 reshaped internals to `_def.type === 'string'`,
 *      so on Zod 4 the default-detect path returned an empty field set —
 *      `searchedFields: []` and no matches.
 *
 *   2. `endpoints.search.paramName` actually wired to the handler.
 *      v0.12.3 hardcoded `c.req.query('q')` regardless of the config.
 *
 *   3. `result_info.total_count` reflects the post-filter result set, not
 *      the adapter's pre-filter candidate count. Implemented at the abstract
 *      layer via the optional `SearchResult.postFilteredCount` contract —
 *      `handle()` prefers it when present.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import { defineModel } from 'hono-crud';
import type { ListFilters } from 'hono-crud/endpoints/types';
import type { SearchOptions, SearchResult } from 'hono-crud/core/types';
import { SearchEndpoint } from 'hono-crud/endpoints/search';
import {
  MemorySearchEndpoint,
  clearStorage,
  getStorage,
} from '@hono-crud/memory';

// ============================================================================
// Fix 1: Zod 4 searchable-field auto-detection
// ============================================================================

describe('Fix 1 — getSearchableFields() works on Zod 4', () => {
  /**
   * Endpoint with NO explicit `searchableFields` / `searchFields` — forces
   * the auto-detect path that v0.12.3 broke under Zod 4.
   */
  const AutoDetectSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    views: z.number().default(0),
    published: z.boolean().default(false),
  });

  const AutoDetectModel = defineModel({
    tableName: 'autodetect',
    schema: AutoDetectSchema,
    primaryKeys: ['id'],
  });

  class AutoDetectSearch extends MemorySearchEndpoint {
    _meta = { model: AutoDetectModel };
    schema = { tags: ['AutoDetect'] };
    // Intentionally no `searchableFields` / `searchFields` overrides —
    // the abstract default-detect path is exercised.

    // Expose the protected helper for direct unit assertion.
    public _getSearchableFieldsPublic() {
      return this.getSearchableFields();
    }
  }

  it('auto-detects string fields on the installed Zod major (Zod 4)', () => {
    const ep = new AutoDetectSearch();
    const fields = ep._getSearchableFieldsPublic();
    expect(Object.keys(fields).sort()).toEqual(['description', 'id', 'title']);
    // Non-string fields must NOT be picked up.
    expect(fields).not.toHaveProperty('views');
    expect(fields).not.toHaveProperty('published');
  });

  it('returns a non-empty field set so default-search end-to-end matches rows', async () => {
    clearStorage();
    const store = getStorage<Record<string, unknown>>('autodetect');
    store.set('a', { id: 'a', title: 'hello world', description: 'something' });
    store.set('b', { id: 'b', title: 'unrelated', description: 'something else' });

    const app = new Hono();
    app.get('/autodetect/search', async (c) => {
      const ep = new AutoDetectSearch();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/autodetect/search?q=hello');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      success: boolean;
      result: Array<{ item: { id: string } }>;
      result_info: { searchedFields: string[] };
    };
    expect(data.success).toBe(true);
    // The v0.12.3 bug would yield `searchedFields: []` and zero matches.
    expect(data.result_info.searchedFields.length).toBeGreaterThan(0);
    expect(data.result.some((r) => r.item.id === 'a')).toBe(true);
  });

  it('still detects a faux Zod-3-shaped string schema (back-compat)', () => {
    // Construct a fixture whose `_def` mimics Zod 3's old `typeName` shape.
    // The detection helper is intentionally dual-shape, so both Zod-3 and
    // Zod-4 introspection patterns are recognised even in monorepos with
    // multiple Zod installs.
    const FakeZod3Schema = {
      shape: {
        title: { _def: { typeName: 'ZodString' } },
        count: { _def: { typeName: 'ZodNumber' } },
      },
    };

    class FauxZod3Search extends MemorySearchEndpoint {
      _meta = { model: AutoDetectModel };
      schema = { tags: ['Fake'] };
      // Override the schema accessor to return the Zod-3-shape fixture.
      protected getModelSchema(): never {
        return FakeZod3Schema as never;
      }
      public _getSearchableFieldsPublic() {
        return this.getSearchableFields();
      }
    }

    const ep = new FauxZod3Search();
    const fields = ep._getSearchableFieldsPublic();
    expect(Object.keys(fields)).toEqual(['title']);
  });
});

// ============================================================================
// Fix 2: paramName config actually changes the wire param
// ============================================================================

describe('Fix 2 — searchParamName changes the on-wire query param', () => {
  const PostSchema = z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
  });

  const PostModel = defineModel({
    tableName: 'posts',
    schema: PostSchema,
    primaryKeys: ['id'],
  });

  class PostSearchCustom extends MemorySearchEndpoint {
    _meta = { model: PostModel };
    schema = { tags: ['Posts'] };
    protected searchableFields = { title: { weight: 2.0 }, body: { weight: 1.0 } };
    // The fix: this should re-route the wire param name through the handler.
    protected searchParamName = 'query';
  }

  beforeEach(() => {
    clearStorage();
    const store = getStorage<Record<string, unknown>>('posts');
    store.set('1', { id: '1', title: 'hello world', body: 'a post body' });
    store.set('2', { id: '2', title: 'goodbye', body: 'another post body' });
  });

  it('reads the configured param name (?query=...)', async () => {
    const app = new Hono();
    app.get('/posts/search', async (c) => {
      const ep = new PostSearchCustom();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/posts/search?query=hello');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      success: boolean;
      result: Array<{ item: { id: string } }>;
      result_info: { query: string };
    };
    expect(data.success).toBe(true);
    expect(data.result_info.query).toBe('hello');
    expect(data.result.some((r) => r.item.id === '1')).toBe(true);
  });

  it('default `q` still works when no paramName override is set', async () => {
    class PostSearchDefault extends MemorySearchEndpoint {
      _meta = { model: PostModel };
      schema = { tags: ['Posts'] };
      protected searchableFields = { title: { weight: 2.0 }, body: { weight: 1.0 } };
      // searchParamName intentionally left at default 'q'
    }

    const app = new Hono();
    app.get('/posts/search', async (c) => {
      const ep = new PostSearchDefault();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/posts/search?q=hello');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean };
    expect(data.success).toBe(true);
  });
});

// ============================================================================
// Fix 3: total_count reconciliation via postFilteredCount
// ============================================================================

describe('Fix 3 — result_info.total_count reflects post-filter result set', () => {
  /**
   * Custom SearchEndpoint subclass that simulates an adapter whose initial
   * SQL `LIKE` hit count is HIGHER than the post-tokenization result set
   * (e.g. stopword query, or minScore clamp). The pre-fix abstract handler
   * would surface the SQL-hit count as `total_count` — misleading for
   * clients computing pagination off it.
   */
  const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
  });

  const ItemModel = defineModel({
    tableName: 'items',
    schema: ItemSchema,
    primaryKeys: ['id'],
  });

  abstract class FakeAdapterSearchBase extends SearchEndpoint {
    _meta = { model: ItemModel };
    schema = { tags: ['Items'] };
    protected searchableFields = { name: { weight: 1.0 } };
  }

  it('uses postFilteredCount when the adapter populates it', async () => {
    class StopwordSimSearch extends FakeAdapterSearchBase {
      async search(
        options: SearchOptions,
        filters: ListFilters,
      ): Promise<SearchResult<Record<string, unknown>>> {
        void options;
        void filters;
        // Simulate: SQL LIKE matched 3 rows, post-tokenization filter
        // (stopword removal) dropped them all.
        return {
          items: [],
          totalCount: 3, // legacy: SQL-hit count
          postFilteredCount: 0, // accurate: nothing survived tokenization
        };
      }
    }

    const app = new Hono();
    app.get('/items/search', async (c) => {
      const ep = new StopwordSimSearch();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/items/search?q=foo');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result: unknown[];
      result_info: { total_count: number; total_pages: number };
    };
    // Critical: total_count must NOT be 3 — that's the misleading SQL count.
    expect(data.result_info.total_count).toBe(0);
    expect(data.result.length).toBe(0);
    expect(data.result_info.total_pages).toBe(0);
  });

  it('falls back to totalCount when postFilteredCount is omitted (back-compat)', async () => {
    class LegacyShapeSearch extends FakeAdapterSearchBase {
      async search(
        options: SearchOptions,
        filters: ListFilters,
      ): Promise<SearchResult<Record<string, unknown>>> {
        void options;
        void filters;
        // Legacy adapter: only `totalCount` populated. Must keep
        // working byte-for-byte (no regression on memory / older
        // adapters that already returned an accurate totalCount).
        return {
          items: [
            { item: { id: '1', name: 'foo' }, score: 1, matchedFields: ['name'] },
            { item: { id: '2', name: 'foobar' }, score: 0.8, matchedFields: ['name'] },
          ],
          totalCount: 2,
        };
      }
    }

    const app = new Hono();
    app.get('/items/search', async (c) => {
      const ep = new LegacyShapeSearch();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/items/search?q=foo');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result: unknown[];
      result_info: { total_count: number; total_pages: number; per_page: number };
    };
    expect(data.result_info.total_count).toBe(2);
    expect(data.result.length).toBe(2);
    expect(data.result_info.total_pages).toBe(1);
  });

  it('pagination math uses the post-filter count', async () => {
    class PartialFilterSearch extends FakeAdapterSearchBase {
      async search(
        options: SearchOptions,
        filters: ListFilters,
      ): Promise<SearchResult<Record<string, unknown>>> {
        void options;
        void filters;
        // SQL matched 100 candidates; minScore clamp left 25.
        return {
          items: [
            { item: { id: '1', name: 'foo' }, score: 1, matchedFields: ['name'] },
          ],
          totalCount: 100,
          postFilteredCount: 25,
        };
      }
    }

    const app = new Hono();
    app.get('/items/search', async (c) => {
      const ep = new PartialFilterSearch();
      ep.setContext(c);
      return ep.handle();
    });

    const res = await app.request('/items/search?q=foo&per_page=10');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result_info: { total_count: number; total_pages: number; per_page: number };
    };
    expect(data.result_info.total_count).toBe(25);
    expect(data.result_info.per_page).toBe(10);
    // 25 / 10 -> 3 pages, not 10 (which the SQL-hit count would have given).
    expect(data.result_info.total_pages).toBe(3);
  });
});
