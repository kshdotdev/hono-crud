# @hono-crud/scalar

Scalar API reference documentation endpoint for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/scalar hono-crud hono
```

## Usage

```ts
import { scalarUI } from '@hono-crud/scalar';
import { Hono } from 'hono';

const app = new Hono(); // exposes its OpenAPI spec at /openapi.json

app.get('/reference', scalarUI({
  specUrl: '/openapi.json',
  pageTitle: 'My API',
}));
```

Exports `scalarUI` and the `ScalarConfig` / `ScalarTheme` types.
