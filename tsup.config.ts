import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/adapters/memory/index.ts',
    'src/adapters/drizzle/index.ts',
    'src/adapters/prisma/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
  external: [
    'drizzle-orm',
    'drizzle-zod',
    '@prisma/client',
    'hono',
    '@hono/zod-openapi',
    '@hono/swagger-ui',
    '@scalar/hono-api-reference',
    'zod',
    'pluralize',
    'fastest-levenshtein',
  ],
});
