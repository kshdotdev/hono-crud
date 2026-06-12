/**
 * Cross-adapter conformance suite (audit findings 73, 74, 76).
 *
 * One set of contract cells — soft-delete lifecycle, filter operator matrix,
 * offset pagination, ETag/If-Match, managed fields, unique-conflict 409,
 * tenant scoping, finalize pipeline, upsert match-and-restore, transactional
 * hooks — executed against every adapter through the real HTTP surface,
 * with exact status codes and exact error-envelope shapes
 * (`{ success: false, error: { code, message } }`).
 *
 * Legs:
 * - memory:  in-process store.
 * - drizzle: real SQL on libsql (throwaway sqlite file; real transactions).
 * - prisma:  REAL PostgreSQL via the examples schema — never mocked. Gated
 *   on DATABASE_URL; requires `pnpm run prisma:generate && pnpm run
 *   prisma:push` first (CI's Postgres service + test:examples step).
 *
 * This suite is the ratchet: new adapter work must keep every cell green or
 * extend the matrix. Capability differences are declared on the adapter
 * descriptor and surface as NAMED skips/variants — never as silent greens.
 */
import { describe } from 'vitest';
import { drizzleConformance } from './adapters/drizzle';
import { memoryConformance } from './adapters/memory';
import { prismaConformance } from './adapters/prisma';
import { registerConformanceCells } from './cells/index';

describe.each([memoryConformance, drizzleConformance])(
  'adapter conformance: $name',
  (descriptor) => {
    registerConformanceCells(descriptor);
  },
);

describe.skipIf(!process.env.DATABASE_URL)(
  `adapter conformance: ${prismaConformance.name} [requires DATABASE_URL]`,
  () => {
    registerConformanceCells(prismaConformance);
  },
);
