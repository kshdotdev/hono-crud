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
});
