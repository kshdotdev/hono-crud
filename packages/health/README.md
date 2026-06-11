# @hono-crud/health

Health check routes for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/health hono-crud hono
```

## Usage

```ts
import { createHealthRoutes } from '@hono-crud/health';

app.route('/', createHealthRoutes({
  path: '/health',
}));
```

Exports `createHealthRoutes`, a router factory returning a mountable `Hono` that owns the liveness (`path`, default `/health`) and readiness (`readyPath`, default `/ready`) routes.
