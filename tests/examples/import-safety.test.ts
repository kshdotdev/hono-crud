import { describe, expect, it } from 'vitest';

const exampleModules = [
  '../../examples/memory/basic-crud',
  '../../examples/memory/soft-delete',
  '../../examples/memory/batch-operations',
  '../../examples/memory/upsert',
  '../../examples/memory/batch-upsert',
  '../../examples/memory/relations',
  '../../examples/memory/cascade-delete',
  '../../examples/memory/nested-writes',
  '../../examples/memory/field-selection',
  '../../examples/memory/computed-fields',
  '../../examples/memory/audit-logging',
  '../../examples/memory/versioning',
  '../../examples/memory/rate-limiting',
  '../../examples/memory/alternative-apis',
  '../../examples/memory/comprehensive',
  '../../examples/drizzle/basic-crud',
  '../../examples/drizzle/filtering',
  '../../examples/drizzle/soft-delete',
  '../../examples/drizzle/batch-operations',
  '../../examples/drizzle/upsert',
  '../../examples/drizzle/relations',
  '../../examples/drizzle/comprehensive',
  '../../examples/drizzle/d1-crud',
  '../../examples/drizzle/with-drizzle-zod',
  '../../examples/prisma/basic-crud',
  '../../examples/prisma/filtering',
  '../../examples/prisma/soft-delete',
  '../../examples/prisma/batch-operations',
  '../../examples/prisma/upsert',
  '../../examples/prisma/relations',
  '../../examples/prisma/comprehensive',
] as const;

describe('example import safety', () => {
  it.each(exampleModules)('imports %s without starting a demo server', async (modulePath) => {
    const imported = await import(modulePath);
    expect(imported).toBeTruthy();
  });
});
