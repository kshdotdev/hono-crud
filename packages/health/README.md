# @hono-crud/health

Health check endpoints for [hono-crud](https://github.com/kshdotdev/hono-crud).

## Install

```bash
npm install @hono-crud/health hono-crud hono
```

## Usage

```ts
import { createHealthEndpoints } from '@hono-crud/health';

createHealthEndpoints(app, {
  path: '/health',
});
```

Exports `createHealthEndpoints` for registering liveness / readiness routes.
