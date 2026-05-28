import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/internal.ts',
    'src/auth/index.ts',
    'src/logging/index.ts',
    'src/storage/index.ts',
    'src/events/index.ts',
    'src/encryption/index.ts',
    'src/serialization/index.ts',
    'src/api-version/index.ts',
    'src/audit/index.ts',
    'src/versioning/index.ts',
    'src/multi-tenant/index.ts',
    'src/types/cloudflare.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  minify: true,
  splitting: true,
  treeshake: true,
  external: ['hono', '@hono/zod-openapi', 'zod'],
});
