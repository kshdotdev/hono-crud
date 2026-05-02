import { serve } from '@hono/node-server';
import { createApp } from './app.js';

export function start(port: number = Number(process.env.PORT) || 3456): unknown {
  const app = createApp();

  console.log(`
=== hono-crud Local File Install Example ===

Server running at http://localhost:${port}
Swagger UI: http://localhost:${port}/docs
OpenAPI: http://localhost:${port}/openapi.json

Try:
  curl http://localhost:${port}/health
  curl http://localhost:${port}/ready
  curl -X POST http://localhost:${port}/users \\
    -H "Content-Type: application/json" \\
    -d '{"email":"alice@example.com","name":"Alice","role":"admin","status":"active","age":33}'
  curl "http://localhost:${port}/users?role=admin&fields=id,email,name,displayName"
  curl "http://localhost:${port}/users/search?q=Alice"
  curl "http://localhost:${port}/users/aggregate?count=*&avg=age&groupBy=role"
`);

  return serve({ fetch: app.fetch, port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
