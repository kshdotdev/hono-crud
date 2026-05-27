# @hono-crud/scalar

Scalar API reference documentation endpoint for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/scalar hono-crud hono
```

## Usage

```ts
import { setupScalar } from '@hono-crud/scalar';

// app exposes its OpenAPI spec at /openapi.json
setupScalar(app, '/scalar', {
  specUrl: '/openapi.json',
  pageTitle: 'My API',
});
```

Exports `setupScalar`, `scalarUI`, and the `ScalarConfig` / `ScalarTheme` types.
