import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/adapters/memory/index.ts',
    'src/adapters/drizzle/index.ts',
    'src/adapters/prisma/index.ts',
    'src/auth/index.ts',
    'src/cache/index.ts',
    'src/rate-limit/index.ts',
    'src/logging/index.ts',
    'src/storage/index.ts',
    'src/ui.ts',
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
  ],
});
