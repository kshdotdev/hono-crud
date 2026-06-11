import { docsIndex, redocUI, swaggerUI } from '@hono-crud/swagger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// ============================================================================
// swaggerUI() Tests
// ============================================================================

describe('swaggerUI', () => {
  it('should return a middleware function', () => {
    const middleware = swaggerUI();
    expect(typeof middleware).toBe('function');
  });

  it('should serve HTML at the mounted path with the default specUrl', async () => {
    const app = new Hono();
    app.get('/docs', swaggerUI());

    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('/openapi.json');
  });

  it('should render a custom specUrl', async () => {
    const app = new Hono();
    app.get('/docs', swaggerUI({ specUrl: '/api/v2/openapi.json' }));

    const res = await app.request('/docs');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('/api/v2/openapi.json');
  });
});

// ============================================================================
// redocUI() Tests
// ============================================================================

describe('redocUI', () => {
  it('should return a middleware function', () => {
    const middleware = redocUI();
    expect(typeof middleware).toBe('function');
  });

  it('should serve HTML with the default specUrl and pageTitle', async () => {
    const app = new Hono();
    app.get('/redoc', redocUI());

    const res = await app.request('/redoc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain("spec-url='/openapi.json'");
    expect(html).toContain('<title>API Documentation</title>');
  });

  it('should render a custom specUrl and pageTitle', async () => {
    const app = new Hono();
    app.get('/redoc', redocUI({ specUrl: '/custom/openapi.json', pageTitle: 'Custom ReDoc' }));

    const res = await app.request('/redoc');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("spec-url='/custom/openapi.json'");
    expect(html).toContain('<title>Custom ReDoc</title>');
  });
});

// ============================================================================
// docsIndex() Tests
// ============================================================================

describe('docsIndex', () => {
  it('should return a middleware function', () => {
    const middleware = docsIndex();
    expect(typeof middleware).toBe('function');
  });

  it('should serve HTML with the default link hrefs and pageTitle', async () => {
    const app = new Hono();
    app.get('/', docsIndex());

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('<title>API Documentation</title>');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="/redoc"');
    expect(html).toContain('href="/reference"');
    expect(html).toContain('href="/openapi.json"');
  });

  it('should render custom link hrefs, specUrl, and pageTitle', async () => {
    const app = new Hono();
    app.get(
      '/',
      docsIndex({
        docsPath: '/swagger',
        redocPath: '/api-redoc',
        scalarPath: '/api-reference',
        specUrl: '/v1/openapi.json',
        pageTitle: 'My Docs Hub',
      }),
    );

    const res = await app.request('/');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<title>My Docs Hub</title>');
    expect(html).toContain('href="/swagger"');
    expect(html).toContain('href="/api-redoc"');
    expect(html).toContain('href="/api-reference"');
    expect(html).toContain('href="/v1/openapi.json"');
  });
});
