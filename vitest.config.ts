import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `@hono/zod-openapi` is a dependency of packages/core (not the monorepo root),
// so the root-level test suite cannot resolve it directly. Resolve it from
// packages/core and alias it so tests under tests/ can import it.
// Use the ESM entry (dist/index.js), not the CJS one — the CJS build pulls in
// a separate `zod` module instance, which means its `.openapi()` prototype
// extension lands on a different Zod than the tests' ESM `zod`, breaking
// OpenAPI generation.
const coreRequire = createRequire(r('./packages/core/package.json'));
const honoZodOpenApi = coreRequire
  .resolve('@hono/zod-openapi')
  .replace(/dist[/\\]index\.cjs$/, 'dist/index.js');

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/workers/**'],
  },
  resolve: {
    // `@hono/zod-openapi` extends Zod's prototype with `.openapi()`. If the
    // test runner loads more than one copy/instance of `zod`, the extension
    // lands on a different prototype than the schemas built in tests, breaking
    // OpenAPI generation. Force a single shared instance.
    dedupe: ['zod', '@hono/zod-openapi'],
    // Run the test suite against package SOURCES (fast, no build step).
    // Order matters: more specific patterns first.
    alias: [
      { find: /^hono-crud\/internal$/, replacement: r('./packages/core/src/internal.ts') },
      { find: /^hono-crud$/, replacement: r('./packages/core/src/index.ts') },
      { find: /^hono-crud\/(.*)$/, replacement: r('./packages/core/src/$1') },
      { find: /^@hono-crud\/memory\/(.*)$/, replacement: r('./packages/memory/src/$1') },
      { find: /^@hono-crud\/memory$/, replacement: r('./packages/memory/src/index.ts') },
      { find: /^@hono-crud\/drizzle\/(.*)$/, replacement: r('./packages/drizzle/src/$1') },
      { find: /^@hono-crud\/drizzle$/, replacement: r('./packages/drizzle/src/index.ts') },
      { find: /^@hono-crud\/prisma\/(.*)$/, replacement: r('./packages/prisma/src/$1') },
      { find: /^@hono-crud\/prisma$/, replacement: r('./packages/prisma/src/index.ts') },
      { find: /^@hono-crud\/swagger$/, replacement: r('./packages/swagger/src/index.ts') },
      { find: /^@hono-crud\/scalar$/, replacement: r('./packages/scalar/src/index.ts') },
      { find: /^@hono-crud\/cache\/(.*)$/, replacement: r('./packages/cache/src/$1') },
      { find: /^@hono-crud\/cache$/, replacement: r('./packages/cache/src/index.ts') },
      { find: /^@hono-crud\/rate-limit\/(.*)$/, replacement: r('./packages/rate-limit/src/$1') },
      { find: /^@hono-crud\/rate-limit$/, replacement: r('./packages/rate-limit/src/index.ts') },
      { find: /^@hono-crud\/idempotency\/(.*)$/, replacement: r('./packages/idempotency/src/$1') },
      { find: /^@hono-crud\/idempotency$/, replacement: r('./packages/idempotency/src/index.ts') },
      { find: /^@hono-crud\/mcp\/(.*)$/, replacement: r('./packages/mcp/src/$1') },
      { find: /^@hono-crud\/mcp$/, replacement: r('./packages/mcp/src/index.ts') },
      { find: /^@hono-crud\/health$/, replacement: r('./packages/health/src/index.ts') },
      { find: /^@hono\/zod-openapi$/, replacement: honoZodOpenApi },
    ],
  },
});
