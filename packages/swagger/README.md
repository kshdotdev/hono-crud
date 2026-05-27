# @hono-crud/swagger

Swagger UI and ReDoc documentation endpoints for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/swagger hono-crud hono
```

## Usage

```ts
import { setupSwaggerUI, setupReDoc } from '@hono-crud/swagger';

// app exposes its OpenAPI spec at /openapi.json
setupSwaggerUI(app, { docsPath: '/docs', specPath: '/openapi.json' });
setupReDoc(app, { docsPath: '/redoc', specPath: '/openapi.json' });
```

Exports `setupSwaggerUI`, `setupReDoc`, `setupDocsIndex`, and the `UIOptions` type. For the Scalar API reference UI, use `@hono-crud/scalar`.
