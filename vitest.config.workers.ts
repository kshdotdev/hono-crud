import { fileURLToPath } from 'node:url';
/**
 * Vitest configuration for Cloudflare Workers edge runtime tests.
 *
 * These tests run inside miniflare (Cloudflare's local simulator) to verify
 * that hono-crud operates correctly in a Workers environment:
 * - No Node.js APIs leak into library code
 * - Web Crypto operations work
 * - KV and D1 storage adapters function correctly
 * - Memory storage works within Worker isolates
 *
 * Prerequisites:
 *   pnpm add -D @cloudflare/vitest-pool-workers @cloudflare/workers-types
 *
 * Run with:
 *   vitest --config vitest.config.workers.ts
 */
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineWorkersConfig({
  test: {
    include: ['tests/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
        miniflare: {
          kvNamespaces: ['CACHE_KV', 'RATE_LIMIT_KV'],
          d1Databases: ['DB'],
        },
      },
    },
  },
  resolve: {
    // Resolve the workspace packages to their sources, mirroring the root
    // vitest config, so workers tests import the new package specifiers.
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
      { find: /^@hono-crud\/health$/, replacement: r('./packages/health/src/index.ts') },
    ],
  },
});
