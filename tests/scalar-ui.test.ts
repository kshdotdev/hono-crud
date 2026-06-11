import { scalarUI } from '@hono-crud/scalar';
import type { ScalarConfig, ScalarTheme } from '@hono-crud/scalar';
import { docsIndex } from '@hono-crud/swagger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scalarUI() Tests
// ============================================================================

describe('scalarUI', () => {
  it('should return a middleware function', () => {
    const middleware = scalarUI();
    expect(typeof middleware).toBe('function');
  });

  it('should use default specUrl when not provided', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI());

    const res = await app.request('/reference');
    expect(res.status).toBe(200);

    const html = await res.text();
    // The default URL should be in the rendered HTML
    expect(html).toContain('/openapi.json');
  });

  it('should use custom specUrl when provided', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI({ specUrl: '/api/v1/openapi.json' }));

    const res = await app.request('/reference');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('/api/v1/openapi.json');
  });

  it('should apply theme configuration', async () => {
    const themes: ScalarTheme[] = ['purple', 'moon', 'default', 'bluePlanet'];

    for (const theme of themes) {
      const app = new Hono();
      app.get('/reference', scalarUI({ theme }));

      const res = await app.request('/reference');
      expect(res.status).toBe(200);

      const html = await res.text();
      // Theme should be included in the configuration
      expect(html).toContain(theme);
    }
  });

  it('should include pageTitle when provided', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI({ pageTitle: 'My Custom API Docs' }));

    const res = await app.request('/reference');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('My Custom API Docs');
  });

  it('should return HTML content type', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI());

    const res = await app.request('/reference');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('should include Scalar script tags', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI());

    const res = await app.request('/reference');
    const html = await res.text();

    // Should include Scalar-related content
    expect(html.toLowerCase()).toContain('scalar');
  });

  it('should work with all configuration options', async () => {
    const config: ScalarConfig = {
      specUrl: '/custom/openapi.json',
      theme: 'saturn',
      pageTitle: 'Saturn API',
      showSidebar: true,
      layout: 'modern',
      hideClientButton: false,
    };

    const app = new Hono();
    app.get('/reference', scalarUI(config));

    const res = await app.request('/reference');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('/custom/openapi.json');
    expect(html).toContain('saturn');
  });

  it('should handle empty config', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI({}));

    const res = await app.request('/reference');
    expect(res.status).toBe(200);
  });

  it('should work with content instead of specUrl', async () => {
    const openApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    };

    const app = new Hono();
    app.get('/reference', scalarUI({ content: openApiSpec }));

    const res = await app.request('/reference');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// scalarUI() mounting Tests
// ============================================================================

describe('scalarUI mounting', () => {
  it('should serve a GET route at the mounted path', async () => {
    const app = new Hono();
    app.get('/docs', scalarUI());

    const res = await app.request('/docs');
    expect(res.status).toBe(200);
  });

  it('should serve at the conventional /reference mount path', async () => {
    const app = new Hono();
    app.get('/reference', scalarUI());

    const res = await app.request('/reference');
    expect(res.status).toBe(200);
  });

  it('should render the provided config', async () => {
    const app = new Hono();
    app.get(
      '/api-docs',
      scalarUI({
        specUrl: '/spec.json',
        theme: 'kepler',
      }),
    );

    const res = await app.request('/api-docs');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('/spec.json');
    expect(html).toContain('kepler');
  });

  it('should not interfere with other routes', async () => {
    const app = new Hono();

    app.get('/health', (c) => c.json({ status: 'ok' }));
    app.get('/reference', scalarUI());
    app.get('/api/users', (c) => c.json({ users: [] }));

    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ status: 'ok' });

    const usersRes = await app.request('/api/users');
    expect(usersRes.status).toBe(200);
    expect(await usersRes.json()).toEqual({ users: [] });

    const docsRes = await app.request('/reference');
    expect(docsRes.status).toBe(200);
    expect(docsRes.headers.get('content-type')).toContain('text/html');
  });

  it('should work with nested paths', async () => {
    const app = new Hono();
    app.get('/api/v1/docs', scalarUI());

    const res = await app.request('/api/v1/docs');
    expect(res.status).toBe(200);
  });

  it('should work with Hono sub-apps', async () => {
    const mainApp = new Hono();
    const subApp = new Hono();

    subApp.get('/docs', scalarUI({ specUrl: '/api/openapi.json' }));

    mainApp.route('/api', subApp);

    const res = await mainApp.request('/api/docs');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('/api/openapi.json');
  });
});

// ============================================================================
// Theme Tests
// ============================================================================

describe('Scalar Themes', () => {
  const allThemes: ScalarTheme[] = [
    'default',
    'alternate',
    'moon',
    'purple',
    'solarized',
    'bluePlanet',
    'saturn',
    'kepler',
    'mars',
    'deepSpace',
    'laserwave',
    'elysiajs',
    'fastify',
    'none',
  ];

  it('should accept all documented themes', async () => {
    for (const theme of allThemes) {
      const app = new Hono();
      app.get('/reference', scalarUI({ theme }));

      const res = await app.request('/reference');
      expect(res.status).toBe(200);
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Scalar Integration', () => {
  it('should work alongside OpenAPI spec endpoint', async () => {
    const app = new Hono();

    // OpenAPI spec endpoint
    app.get('/openapi.json', (c) =>
      c.json({
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              summary: 'List users',
              responses: { 200: { description: 'Success' } },
            },
          },
        },
      }),
    );

    // Scalar UI
    app.get('/reference', scalarUI({ specUrl: '/openapi.json' }));

    // Test OpenAPI endpoint
    const specRes = await app.request('/openapi.json');
    expect(specRes.status).toBe(200);
    const spec = await specRes.json();
    expect(spec.info.title).toBe('Test API');

    // Test Scalar UI
    const docsRes = await app.request('/reference');
    expect(docsRes.status).toBe(200);
    expect(docsRes.headers.get('content-type')).toContain('text/html');
  });

  it('should work with baseServerURL configuration', async () => {
    const app = new Hono();
    app.get(
      '/reference',
      scalarUI({
        specUrl: '/openapi.json',
        baseServerURL: 'https://api.example.com',
      }),
    );

    const res = await app.request('/reference');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('https://api.example.com');
  });

  it('docs hub links to the path scalar serves by default', async () => {
    const app = new Hono();

    // The agreement between the docs hub and the scalar UI is a
    // documented-default contract, not runtime wiring: DocsIndexConfig.scalarPath
    // defaults to '/reference', the conventional scalar mount path.
    app.get('/', docsIndex());
    app.get('/reference', scalarUI());

    // The hub renders a link to Scalar; extract its href, pin it to the
    // documented default, and follow it.
    const hubRes = await app.request('/');
    const hubHtml = await hubRes.text();
    const scalarHref = hubHtml.match(/href="([^"]*)"[^>]*>Open Scalar/)?.[1];
    expect(scalarHref).toBe('/reference');

    const linkedRes = await app.request(scalarHref as string);
    expect(linkedRes.status).toBe(200);
    expect(linkedRes.headers.get('content-type')).toContain('text/html');
  });
});
