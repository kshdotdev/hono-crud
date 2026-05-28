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
  external: [
    'hono-crud',
    'hono-crud/internal',
    'hono',
    '@hono/mcp',
    '@modelcontextprotocol/sdk',
    'hono-rate-limiter',
    'zod',
  ],
});
