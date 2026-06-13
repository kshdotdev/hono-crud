# @hono-crud/swagger

Swagger UI and ReDoc documentation pages for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/swagger hono-crud hono
```

## Usage

```ts
import { docsIndex, redocUI, swaggerUI } from '@hono-crud/swagger';
import { Hono } from 'hono';

const app = new Hono(); // exposes its OpenAPI spec at /openapi.json

app.get('/docs', swaggerUI({ specUrl: '/openapi.json' }));
app.get('/redoc', redocUI({ specUrl: '/openapi.json', pageTitle: 'My API' }));

// Optional landing page linking to all docs UIs
app.get('/', docsIndex({ docsPath: '/docs', redocPath: '/redoc', scalarPath: '/reference' }));
```

Each factory returns a `MiddlewareHandler` you mount with `app.get(path, ...)`.

Exports `swaggerUI`, `redocUI`, `docsIndex`, and the `SwaggerUIConfig` / `RedocUIConfig` / `DocsIndexConfig` types. All configs accept `specUrl` (default `/openapi.json`); `redocUI` and `docsIndex` also accept `pageTitle`. For the Scalar API reference UI, use `@hono-crud/scalar`.
