import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  minify: true,
  splitting: true,
  treeshake: true,
  external: ['hono', '@scalar/hono-api-reference'],
});
