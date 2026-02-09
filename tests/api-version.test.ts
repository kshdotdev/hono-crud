import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  apiVersion,
  getApiVersion,
  getApiVersionConfig,
  versionedResponse,
} from '../src/api-version/index';

describe('API Versioning', () => {
  describe('header strategy', () => {
    it('should extract version from Accept-Version header', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [
          { version: '2' },
          { version: '1' },
        ],
        defaultVersion: '2',
      }));
      app.get('/test', (c) => {
        return c.json({ version: getApiVersion(c) });
      });

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBe('1');
    });

    it('should use default version when no header', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '2' }, { version: '1' }],
        defaultVersion: '2',
      }));
      app.get('/test', (c) => c.json({ version: getApiVersion(c) }));

      const res = await app.request('/test');
      const body = await res.json();
      expect(body.version).toBe('2');
    });

    it('should return 400 for unsupported version', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }],
      }));
      app.get('/test', (c) => c.json({}));
      app.onError((err, c) => {
        return c.json({ error: err.message }, 400);
      });

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '99' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('query strategy', () => {
    it('should extract version from query parameter', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }, { version: '2' }],
        strategy: 'query',
        defaultVersion: '1',
      }));
      app.get('/test', (c) => c.json({ version: getApiVersion(c) }));

      const res = await app.request('/test?version=2');
      const body = await res.json();
      expect(body.version).toBe('2');
    });

    it('should use custom query param name', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }, { version: '2' }],
        strategy: 'query',
        queryParam: 'v',
        defaultVersion: '1',
      }));
      app.get('/test', (c) => c.json({ version: getApiVersion(c) }));

      const res = await app.request('/test?v=2');
      const body = await res.json();
      expect(body.version).toBe('2');
    });
  });

  describe('url strategy', () => {
    it('should extract version from URL path', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }, { version: '2' }],
        strategy: 'url',
        defaultVersion: '1',
      }));
      app.get('/v1/test', (c) => c.json({ version: getApiVersion(c) }));
      app.get('/v2/test', (c) => c.json({ version: getApiVersion(c) }));

      const res = await app.request('/v2/test');
      const body = await res.json();
      expect(body.version).toBe('2');
    });
  });

  describe('custom extractor', () => {
    it('should use custom version extractor', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: 'v1' }, { version: 'v2' }],
        extractVersion: (ctx) => ctx.req.header('X-Custom-Version'),
        defaultVersion: 'v1',
      }));
      app.get('/test', (c) => c.json({ version: getApiVersion(c) }));

      const res = await app.request('/test', {
        headers: { 'X-Custom-Version': 'v2' },
      });
      const body = await res.json();
      expect(body.version).toBe('v2');
    });
  });

  describe('response headers', () => {
    it('should add X-API-Version header', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }],
      }));
      app.get('/test', (c) => c.json({}));

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      expect(res.headers.get('X-API-Version')).toBe('1');
    });

    it('should add Deprecation and Sunset headers', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [
          { version: '1', deprecated: '2024-06-01', sunset: '2025-01-01' },
        ],
      }));
      app.get('/test', (c) => c.json({}));

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      expect(res.headers.get('Deprecation')).toBe('2024-06-01');
      expect(res.headers.get('Sunset')).toBe('2025-01-01');
    });

    it('should skip headers when addHeaders is false', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [{ version: '1' }],
        addHeaders: false,
      }));
      app.get('/test', (c) => c.json({}));

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      expect(res.headers.get('X-API-Version')).toBeNull();
    });
  });

  describe('getApiVersionConfig', () => {
    it('should return full version config from context', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [
          { version: '1', deprecated: '2024-01-01' },
        ],
      }));
      app.get('/test', (c) => {
        const config = getApiVersionConfig(c);
        return c.json({
          version: config?.version,
          deprecated: config?.deprecated,
        });
      });

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      const body = await res.json();
      expect(body.version).toBe('1');
      expect(body.deprecated).toBe('2024-01-01');
    });
  });

  describe('versionedResponse', () => {
    it('should transform response based on version', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [
          { version: '2' },
          {
            version: '1',
            responseTransformer: (data) => {
              const { firstName, lastName, ...rest } = data;
              return { ...rest, fullName: `${firstName} ${lastName}` };
            },
          },
        ],
        defaultVersion: '2',
      }));
      // versionedResponse must wrap the handler
      app.use('*', versionedResponse());
      app.get('/user', (c) => {
        return c.json({ firstName: 'John', lastName: 'Doe', id: '1' });
      });

      // v1 should transform
      const res1 = await app.request('/user', {
        headers: { 'Accept-Version': '1' },
      });
      const body1 = await res1.json();
      expect(body1.fullName).toBe('John Doe');
      expect(body1.firstName).toBeUndefined();

      // v2 should not transform
      const res2 = await app.request('/user', {
        headers: { 'Accept-Version': '2' },
      });
      const body2 = await res2.json();
      expect(body2.firstName).toBe('John');
      expect(body2.fullName).toBeUndefined();
    });
  });

  describe('version-specific middleware', () => {
    it('should apply version-specific middleware', async () => {
      const app = new Hono();
      app.use('*', apiVersion({
        versions: [
          {
            version: '2',
            middleware: [
              async (c, next) => {
                c.header('X-V2-Applied', 'true');
                await next();
              },
            ],
          },
          { version: '1' },
        ],
        defaultVersion: '1',
      }));
      app.get('/test', (c) => c.json({}));

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '2' },
      });
      expect(res.headers.get('X-V2-Applied')).toBe('true');

      const res2 = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });
      expect(res2.headers.get('X-V2-Applied')).toBeNull();
    });
  });
});
