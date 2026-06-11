import { swaggerUI as honoSwaggerUI } from '@hono/swagger-ui';
import type { MiddlewareHandler } from 'hono';

/**
 * Config for the Swagger UI page middleware.
 */
export interface SwaggerUIConfig {
  /**
   * URL to the OpenAPI spec file.
   * @default '/openapi.json'
   */
  specUrl?: string;
}

/**
 * Creates a Swagger UI documentation-page middleware.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { swaggerUI } from '@hono-crud/swagger';
 *
 * const app = new Hono();
 *
 * app.get('/docs', swaggerUI({ specUrl: '/openapi.json' }));
 * ```
 */
export function swaggerUI(config: SwaggerUIConfig = {}): MiddlewareHandler {
  return honoSwaggerUI({ url: config.specUrl ?? '/openapi.json' });
}

/**
 * Config for the ReDoc page middleware.
 */
export interface RedocUIConfig {
  /**
   * URL to the OpenAPI spec file.
   * @default '/openapi.json'
   */
  specUrl?: string;
  /**
   * Page title for the documentation.
   * @default 'API Documentation'
   */
  pageTitle?: string;
}

/**
 * Creates a ReDoc documentation-page middleware (rendered via CDN bundle).
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { redocUI } from '@hono-crud/swagger';
 *
 * const app = new Hono();
 *
 * app.get('/redoc', redocUI({ specUrl: '/openapi.json', pageTitle: 'My API' }));
 * ```
 */
export function redocUI(config: RedocUIConfig = {}): MiddlewareHandler {
  const { specUrl = '/openapi.json', pageTitle = 'API Documentation' } = config;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${pageTitle}</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url='${specUrl}'></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

  return async (c) => c.html(html);
}

/**
 * Config for the documentation landing page. Path fields are LINK HREFS rendered
 * into the page — not route registrations (the page itself is mounted wherever
 * the `app.get` call site puts it).
 */
export interface DocsIndexConfig {
  /**
   * Href of the Swagger UI page link.
   * @default '/docs'
   */
  docsPath?: string;
  /**
   * Href of the ReDoc page link.
   * @default '/redoc'
   */
  redocPath?: string;
  /**
   * Href of the Scalar page link.
   * @default '/reference'
   */
  scalarPath?: string;
  /**
   * URL to the OpenAPI spec file.
   * @default '/openapi.json'
   */
  specUrl?: string;
  /**
   * Page title for the landing page.
   * @default 'API Documentation'
   */
  pageTitle?: string;
}

/**
 * Creates a middleware serving a simple HTML landing page that links to the
 * available documentation endpoints.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { docsIndex } from '@hono-crud/swagger';
 *
 * const app = new Hono();
 *
 * app.get('/', docsIndex({ pageTitle: 'My API' }));
 * ```
 */
export function docsIndex(config: DocsIndexConfig = {}): MiddlewareHandler {
  const {
    docsPath = '/docs',
    redocPath = '/redoc',
    scalarPath = '/reference',
    specUrl = '/openapi.json',
    pageTitle = 'API Documentation',
  } = config;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${pageTitle}</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        max-width: 600px;
        margin: 50px auto;
        padding: 20px;
        background: #f5f5f5;
      }
      h1 { color: #333; }
      .card {
        background: white;
        border-radius: 8px;
        padding: 20px;
        margin: 15px 0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .card h2 { margin-top: 0; color: #444; }
      .card p { color: #666; margin-bottom: 15px; }
      .card a {
        display: inline-block;
        background: #0066cc;
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        text-decoration: none;
      }
      .card a:hover { background: #0052a3; }
      .card.redoc a { background: #e53935; }
      .card.redoc a:hover { background: #c62828; }
      .card.scalar a { background: #8b5cf6; }
      .card.scalar a:hover { background: #7c3aed; }
      .card.json a { background: #43a047; }
      .card.json a:hover { background: #2e7d32; }
    </style>
  </head>
  <body>
    <h1>${pageTitle}</h1>

    <div class="card">
      <h2>Swagger UI</h2>
      <p>Interactive API documentation with try-it-out functionality.</p>
      <a href="${docsPath}">Open Swagger UI &rarr;</a>
    </div>

    <div class="card redoc">
      <h2>ReDoc</h2>
      <p>Clean, responsive API documentation.</p>
      <a href="${redocPath}">Open ReDoc &rarr;</a>
    </div>

    <div class="card scalar">
      <h2>Scalar</h2>
      <p>Modern, beautiful API reference documentation.</p>
      <a href="${scalarPath}">Open Scalar &rarr;</a>
    </div>

    <div class="card json">
      <h2>OpenAPI Spec</h2>
      <p>Raw OpenAPI 3.1 JSON specification.</p>
      <a href="${specUrl}">View JSON &rarr;</a>
    </div>
  </body>
</html>`;

  return async (c) => c.html(html);
}
