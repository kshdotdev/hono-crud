/**
 * Tests for search functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  defineModel,
  tokenize,
  tokenizeQuery,
  calculateScore,
  generateHighlights,
  parseSearchFields,
  buildSearchConfig,
} from '../src/index.js';
import {
  MemorySearchEndpoint,
  clearStorage,
  getStorage,
} from '../src/adapters/memory/index.js';

// Define test schema
const ArticleSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
  author: z.string(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'archived']),
  views: z.number().default(0),
  deletedAt: z.date().nullable().optional(),
});

// Define model
const ArticleModel = defineModel({
  tableName: 'articles',
  schema: ArticleSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
});

// Test endpoint
class ArticleSearch extends MemorySearchEndpoint {
  _meta = { model: ArticleModel };
  schema = { tags: ['Articles'], summary: 'Search articles' };

  protected searchableFields = {
    title: { weight: 2.0 },
    content: { weight: 1.0 },
    author: { weight: 1.5 },
  };

  protected filterFields = ['status'];
  protected filterConfig = {
    views: ['gt', 'gte', 'lt', 'lte', 'eq'] as const,
  };

  protected orderByFields = ['title', 'views', 'author'];
}

describe('Search Utilities', () => {
  describe('tokenize', () => {
    it('should tokenize a simple string', () => {
      const tokens = tokenize('Hello World');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should remove punctuation', () => {
      const tokens = tokenize("Hello, World! How's it going?");
      expect(tokens).toEqual(['hello', 'world', 'how', 'going']);
    });

    it('should filter stop words by default', () => {
      const tokens = tokenize('The quick brown fox');
      expect(tokens).toEqual(['quick', 'brown', 'fox']);
    });

    it('should keep stop words when disabled', () => {
      const tokens = tokenize('The quick brown fox', false);
      expect(tokens).toContain('the');
    });

    it('should handle empty string', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should filter single-character tokens', () => {
      const tokens = tokenize('a b c test');
      expect(tokens).toEqual(['test']);
    });
  });

  describe('tokenizeQuery', () => {
    it('should tokenize query for any mode', () => {
      const tokens = tokenizeQuery('hello world', 'any');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should tokenize query for all mode', () => {
      const tokens = tokenizeQuery('hello world', 'all');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should keep phrase intact for phrase mode', () => {
      const tokens = tokenizeQuery('Hello World', 'phrase');
      expect(tokens).toEqual(['hello world']);
    });
  });

  describe('calculateScore', () => {
    const searchFields = {
      title: { weight: 2.0 },
      content: { weight: 1.0 },
    };

    it('should calculate score for matching record', () => {
      const record = {
        title: 'Introduction to TypeScript',
        content: 'TypeScript is a typed superset of JavaScript',
      };

      const { score, matchedFields } = calculateScore(
        record,
        ['typescript'],
        searchFields,
        'any'
      );

      expect(score).toBeGreaterThan(0);
      expect(matchedFields).toContain('title');
      expect(matchedFields).toContain('content');
    });

    it('should return zero score for non-matching record', () => {
      const record = {
        title: 'Introduction to Python',
        content: 'Python is a dynamic language',
      };

      const { score, matchedFields } = calculateScore(
        record,
        ['typescript'],
        searchFields,
        'any'
      );

      expect(score).toBe(0);
      expect(matchedFields).toHaveLength(0);
    });

    it('should weight fields appropriately', () => {
      const recordTitleMatch = {
        title: 'TypeScript Guide',
        content: 'Some other content',
      };

      const recordContentMatch = {
        title: 'Some title',
        content: 'Learn TypeScript today',
      };

      const titleScore = calculateScore(
        recordTitleMatch,
        ['typescript'],
        searchFields,
        'any'
      );

      const contentScore = calculateScore(
        recordContentMatch,
        ['typescript'],
        searchFields,
        'any'
      );

      // Title has weight 2.0, content has weight 1.0
      expect(titleScore.score).toBeGreaterThan(contentScore.score);
    });

    it('should require all terms for all mode', () => {
      const record = {
        title: 'TypeScript Guide',
        content: 'Introduction to TypeScript',
      };

      const anyResult = calculateScore(
        record,
        ['typescript', 'python'],
        searchFields,
        'any'
      );

      const allResult = calculateScore(
        record,
        ['typescript', 'python'],
        searchFields,
        'all'
      );

      expect(anyResult.score).toBeGreaterThan(0);
      expect(allResult.score).toBe(0); // python not found
    });
  });

  describe('generateHighlights', () => {
    it('should highlight matching term', () => {
      const highlights = generateHighlights(
        'TypeScript is great for building applications',
        ['typescript'],
        'any'
      );

      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toContain('<mark>TypeScript</mark>');
    });

    it('should highlight phrase', () => {
      const highlights = generateHighlights(
        'The quick brown fox jumps over the lazy dog',
        ['quick brown'],
        'phrase'
      );

      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toContain('<mark>quick brown</mark>');
    });

    it('should handle no matches', () => {
      const highlights = generateHighlights(
        'Hello world',
        ['typescript'],
        'any'
      );

      expect(highlights).toHaveLength(0);
    });

    it('should handle array values', () => {
      const highlights = generateHighlights(
        ['tag1', 'typescript', 'tag3'],
        ['typescript'],
        'any'
      );

      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toContain('<mark>typescript</mark>');
    });
  });

  describe('parseSearchFields', () => {
    const configuredFields = {
      title: { weight: 2.0 },
      content: { weight: 1.0 },
      author: { weight: 1.5 },
    };

    it('should return all configured fields when no param', () => {
      const fields = parseSearchFields(undefined, configuredFields);
      expect(fields).toEqual(['title', 'content', 'author']);
    });

    it('should parse comma-separated fields', () => {
      const fields = parseSearchFields('title,content', configuredFields);
      expect(fields).toEqual(['title', 'content']);
    });

    it('should filter to only configured fields', () => {
      const fields = parseSearchFields('title,invalid,content', configuredFields);
      expect(fields).toEqual(['title', 'content']);
    });
  });

  describe('buildSearchConfig', () => {
    it('should build config with default weights', () => {
      const config = buildSearchConfig(['title', 'content']);
      expect(config).toEqual({
        title: { weight: 1.0 },
        content: { weight: 1.0 },
      });
    });

    it('should apply custom weights', () => {
      const config = buildSearchConfig(['title', 'content'], { title: 2.0 });
      expect(config).toEqual({
        title: { weight: 2.0 },
        content: { weight: 1.0 },
      });
    });
  });
});

describe('MemorySearchEndpoint', () => {
  let app: Hono;

  beforeEach(() => {
    clearStorage();

    // Seed test data
    const store = getStorage<Record<string, unknown>>('articles');

    const articles = [
      {
        id: '1',
        title: 'Introduction to TypeScript',
        content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
        author: 'John Doe',
        status: 'published',
        views: 100,
      },
      {
        id: '2',
        title: 'Advanced TypeScript Patterns',
        content: 'Learn advanced patterns and best practices for TypeScript development.',
        author: 'Jane Smith',
        status: 'published',
        views: 250,
      },
      {
        id: '3',
        title: 'Getting Started with React',
        content: 'React is a JavaScript library for building user interfaces.',
        author: 'John Doe',
        status: 'published',
        views: 500,
      },
      {
        id: '4',
        title: 'TypeScript with React',
        content: 'How to use TypeScript in your React projects for better type safety.',
        author: 'Jane Smith',
        status: 'draft',
        views: 50,
      },
      {
        id: '5',
        title: 'Python Basics',
        content: 'An introduction to Python programming language.',
        author: 'Bob Wilson',
        status: 'published',
        views: 75,
      },
      {
        id: '6',
        title: 'Deleted Article',
        content: 'This article was deleted.',
        author: 'Admin',
        status: 'archived',
        views: 10,
        deletedAt: new Date(),
      },
    ];

    for (const article of articles) {
      store.set(article.id, article);
    }

    app = new Hono();

    app.onError((err, c) => {
      return c.json({ success: false, error: { message: err.message } }, 400);
    });

    app.get('/articles/search', async (c) => {
      const endpoint = new ArticleSearch();
      endpoint.setContext(c);
      return endpoint.handle();
    });
  });

  it('should search for TypeScript articles', async () => {
    const response = await app.request('/articles/search?q=typescript');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      success: boolean;
      result: Array<{ item: { title: string }; score: number }>;
      result_info: { total_count: number; query: string };
    };

    expect(data.success).toBe(true);
    expect(data.result.length).toBeGreaterThan(0);
    expect(data.result_info.query).toBe('typescript');

    // All results should contain TypeScript
    for (const result of data.result) {
      const titleLower = result.item.title.toLowerCase();
      const hasMatch = titleLower.includes('typescript');
      expect(hasMatch || result.score > 0).toBe(true);
    }
  });

  it('should return results sorted by relevance score', async () => {
    const response = await app.request('/articles/search?q=typescript');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ score: number }>;
    };

    // Results should be sorted by score descending
    for (let i = 1; i < data.result.length; i++) {
      expect(data.result[i - 1].score).toBeGreaterThanOrEqual(data.result[i].score);
    }
  });

  it('should include highlights when requested', async () => {
    const response = await app.request('/articles/search?q=typescript&highlight=true');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ highlights?: Record<string, string[]> }>;
    };

    // At least some results should have highlights
    const hasHighlights = data.result.some(r => r.highlights && Object.keys(r.highlights).length > 0);
    expect(hasHighlights).toBe(true);
  });

  it('should filter by status', async () => {
    const response = await app.request('/articles/search?q=typescript&status=published');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { status: string } }>;
    };

    // All results should be published
    for (const result of data.result) {
      expect(result.item.status).toBe('published');
    }
  });

  it('should exclude soft-deleted records by default', async () => {
    const response = await app.request('/articles/search?q=deleted');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { title: string } }>;
    };

    // Should not find the deleted article
    const hasDeleted = data.result.some(r => r.item.title === 'Deleted Article');
    expect(hasDeleted).toBe(false);
  });

  it('should search specific fields only', async () => {
    const response = await app.request('/articles/search?q=john&fields=author');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { author: string }; matchedFields: string[] }>;
      result_info: { searchedFields: string[] };
    };

    expect(data.result_info.searchedFields).toEqual(['author']);

    // All matched fields should be author
    for (const result of data.result) {
      expect(result.matchedFields).toContain('author');
    }
  });

  it('should support phrase mode', async () => {
    const response = await app.request('/articles/search?q=Getting%20Started&mode=phrase');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { title: string } }>;
    };

    // Should find "Getting Started with React"
    const found = data.result.some(r => r.item.title.includes('Getting Started'));
    expect(found).toBe(true);
  });

  it('should support all mode (AND)', async () => {
    const response = await app.request('/articles/search?q=typescript%20react&mode=all');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { title: string; content: string } }>;
    };

    // Results should contain both typescript AND react
    for (const result of data.result) {
      const text = (result.item.title + ' ' + result.item.content).toLowerCase();
      expect(text).toContain('typescript');
      expect(text).toContain('react');
    }
  });

  it('should paginate results', async () => {
    const response = await app.request('/articles/search?q=typescript&per_page=2&page=1');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<unknown>;
      result_info: { page: number; per_page: number; total_count: number };
    };

    expect(data.result.length).toBeLessThanOrEqual(2);
    expect(data.result_info.page).toBe(1);
    expect(data.result_info.per_page).toBe(2);
  });

  it('should return error for query too short', async () => {
    const response = await app.request('/articles/search?q=a');

    expect(response.status).toBe(400);
    const data = await response.json() as {
      success: boolean;
      error: { code?: string; message: string };
    };

    expect(data.success).toBe(false);
    // The error could come from Zod validation (string too short) or our custom check
    expect(data.error.message).toBeDefined();
  });

  it('should support sorting by field', async () => {
    const response = await app.request('/articles/search?q=typescript&order_by=views&order_by_direction=desc');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { views: number } }>;
    };

    // Results should be sorted by views descending
    for (let i = 1; i < data.result.length; i++) {
      expect(data.result[i - 1].item.views).toBeGreaterThanOrEqual(data.result[i].item.views);
    }
  });

  it('should include matched fields in results', async () => {
    const response = await app.request('/articles/search?q=john');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ matchedFields: string[] }>;
    };

    // Results should have matchedFields array
    for (const result of data.result) {
      expect(Array.isArray(result.matchedFields)).toBe(true);
      expect(result.matchedFields.length).toBeGreaterThan(0);
    }
  });

  it('should apply minimum score filter', async () => {
    const response = await app.request('/articles/search?q=typescript&minScore=0.5');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ score: number }>;
    };

    // All scores should be >= 0.5
    for (const result of data.result) {
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('should combine search with filter operators', async () => {
    const response = await app.request('/articles/search?q=typescript&views[gte]=100');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      result: Array<{ item: { views: number } }>;
    };

    // All views should be >= 100
    for (const result of data.result) {
      expect(result.item.views).toBeGreaterThanOrEqual(100);
    }
  });
});
