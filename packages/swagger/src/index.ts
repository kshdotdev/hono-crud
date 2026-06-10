import { swaggerUI } from '@hono/swagger-ui';
import type { Env, Hono } from 'hono';

export interface UIOptions {
  /**
   * Path to serve Swagger UI (default: '/docs')
   */
  docsPath?: string;
  /**
   * Path to serve ReDoc (default: '/redoc')
   */
  redocPath?: string;
  /**
   * Path to serve Scalar (default: '/reference')
   */
  scalarPath?: string;
  /**
   * Path to the OpenAPI JSON spec (default: '/openapi.json')
   */
  specPath?: string;
  /**
   * Page title for the documentation
   */
  title?: string;
}

/**
 * Sets up Swagger UI endpoint.
 */
export function setupSwaggerUI<E extends Env>(app: Hono<E>, options: UIOptions = {}): void {
  const { docsPath = '/docs', specPath = '/openapi.json' } = options;

  app.get(docsPath, swaggerUI({ url: specPath }));
}

/**
 * Sets up ReDoc endpoint using CDN.
 */
export function setupReDoc<E extends Env>(app: Hono<E>, options: UIOptions = {}): void {
  const { redocPath = '/redoc', specPath = '/openapi.json', title = 'API Documentation' } = options;

  app.get(redocPath, (c) => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url='${specPath}'></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
    return c.html(html);
  });
}

/**
 * Returns a simple HTML page listing available documentation endpoints.
 */
export function setupDocsIndex<E extends Env>(
  app: Hono<E>,
  options: UIOptions & { indexPath?: string } = {},
): void {
  const {
    indexPath = '/',
    docsPath = '/docs',
    redocPath = '/redoc',
    scalarPath = '/reference',
    specPath = '/openapi.json',
    title = 'API Documentation',
  } = options;

  app.get(indexPath, (c) => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
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
    <h1>${title}</h1>

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
      <a href="${specPath}">View JSON &rarr;</a>
    </div>
  </body>
</html>`;
    return c.html(html);
  });
}
