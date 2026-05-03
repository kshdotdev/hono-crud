import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { app as drizzleApp } from '../../examples/drizzle/comprehensive';
import { closeDb as closeDrizzleDb, initDb as initDrizzleDb } from '../../examples/drizzle/db';
import { app as prismaApp } from '../../examples/prisma/comprehensive';
import { clearDb as clearPrismaDb, closeDb as closePrismaDb, initDb as initPrismaDb } from '../../examples/prisma/db';
import { clear, exerciseClone, exerciseComprehensiveCrud } from './harness';

describe('database-backed comprehensive examples', () => {
  describe('drizzle postgres example', () => {
    beforeAll(async () => {
      await initDrizzleDb();
    });

    beforeEach(async () => {
      await clear(drizzleApp);
    });

    afterAll(async () => {
      await closeDrizzleDb();
    });

    it('runs the public CRUD feature flow through the exported app', async () => {
      await exerciseComprehensiveCrud(drizzleApp);
    });

    it('clones a user with body overrides and rejects soft-deleted/missing sources', async () => {
      await exerciseClone(drizzleApp);
    });
  });

  describe('prisma postgres example', () => {
    beforeAll(async () => {
      await initPrismaDb();
    });

    beforeEach(async () => {
      await clearPrismaDb();
    });

    afterAll(async () => {
      await closePrismaDb();
    });

    it('runs the public CRUD feature flow through the exported app', async () => {
      await exerciseComprehensiveCrud(prismaApp);
    });

    it('clones a user with body overrides and rejects soft-deleted/missing sources', async () => {
      await exerciseClone(prismaApp);
    });
  });
});
