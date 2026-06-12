import type { Env } from 'hono';
import type { MetaInput } from 'hono-crud/internal';
import {
  PrismaAggregateEndpoint,
  PrismaCloneEndpoint,
  PrismaExportEndpoint,
  PrismaImportEndpoint,
  PrismaSearchEndpoint,
  PrismaUpsertEndpoint,
} from './advanced';
import {
  PrismaBatchCreateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchUpsertEndpoint,
  PrismaRestoreEndpoint,
} from './batch';
import {
  PrismaCreateEndpoint,
  PrismaDeleteEndpoint,
  PrismaListEndpoint,
  PrismaReadEndpoint,
  PrismaUpdateEndpoint,
} from './crud';
import type { PrismaClient } from './helpers';

/**
 * Return type of createPrismaCrud factory function.
 * Provides type-safe base classes for all CRUD operations.
 */
type ConfiguredPrismaEndpoint<TEndpoint, M extends MetaInput> = new () => TEndpoint & {
  _meta: M;
  prisma: PrismaClient;
};

export interface PrismaCrudClasses<M extends MetaInput, E extends Env = Env> {
  Create: ConfiguredPrismaEndpoint<PrismaCreateEndpoint<E, M>, M>;
  Read: ConfiguredPrismaEndpoint<PrismaReadEndpoint<E, M>, M>;
  Update: ConfiguredPrismaEndpoint<PrismaUpdateEndpoint<E, M>, M>;
  Delete: ConfiguredPrismaEndpoint<PrismaDeleteEndpoint<E, M>, M>;
  List: ConfiguredPrismaEndpoint<PrismaListEndpoint<E, M>, M>;
  Restore: ConfiguredPrismaEndpoint<PrismaRestoreEndpoint<E, M>, M>;
  Upsert: ConfiguredPrismaEndpoint<PrismaUpsertEndpoint<E, M>, M>;
  Search: ConfiguredPrismaEndpoint<PrismaSearchEndpoint<E, M>, M>;
  Aggregate: ConfiguredPrismaEndpoint<PrismaAggregateEndpoint<E, M>, M>;
  Export: ConfiguredPrismaEndpoint<PrismaExportEndpoint<E, M>, M>;
  Import: ConfiguredPrismaEndpoint<PrismaImportEndpoint<E, M>, M>;
  Clone: ConfiguredPrismaEndpoint<PrismaCloneEndpoint<E, M>, M>;
  BatchCreate: ConfiguredPrismaEndpoint<PrismaBatchCreateEndpoint<E, M>, M>;
  BatchUpdate: ConfiguredPrismaEndpoint<PrismaBatchUpdateEndpoint<E, M>, M>;
  BatchDelete: ConfiguredPrismaEndpoint<PrismaBatchDeleteEndpoint<E, M>, M>;
  BatchRestore: ConfiguredPrismaEndpoint<PrismaBatchRestoreEndpoint<E, M>, M>;
  BatchUpsert: ConfiguredPrismaEndpoint<PrismaBatchUpsertEndpoint<E, M>, M>;
}

/**
 * Creates a set of Prisma CRUD endpoint base classes with prisma and meta pre-configured.
 * This is the cleanest pattern - no need to set `_meta` or `prisma` in your classes.
 *
 * @param prisma - Your Prisma client instance
 * @param meta - The meta object (from defineMeta)
 * @returns Object with Create, Read, Update, Delete, List, ... base classes
 *
 * @example
 * ```ts
 * import { createPrismaCrud } from '@hono-crud/prisma';
 *
 * const userMeta = defineMeta({ model: UserModel, fields: userSchemas.insert });
 * const User = createPrismaCrud(prisma, userMeta);
 *
 * // Now define endpoints with minimal boilerplate:
 * class UserCreate extends User.Create {
 *   schema = { tags: ["Users"], summary: "Create a new user" };
 * }
 *
 * class UserList extends User.List {
 *   schema = { tags: ["Users"], summary: "List all users" };
 *   protected searchFields = ["name", "email"];
 *   protected filterFields = ["role"];
 * }
 * ```
 */
export function createPrismaCrud<M extends MetaInput, E extends Env = Env>(
  prisma: PrismaClient,
  meta: M,
): PrismaCrudClasses<M, E> {
  // Use type assertion to avoid TypeScript's anonymous class protected member restriction
  return {
    Create: class extends PrismaCreateEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Read: class extends PrismaReadEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Update: class extends PrismaUpdateEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Delete: class extends PrismaDeleteEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    List: class extends PrismaListEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Restore: class extends PrismaRestoreEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Upsert: class extends PrismaUpsertEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Search: class extends PrismaSearchEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Aggregate: class extends PrismaAggregateEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Export: class extends PrismaExportEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Import: class extends PrismaImportEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    Clone: class extends PrismaCloneEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    BatchCreate: class extends PrismaBatchCreateEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    BatchUpdate: class extends PrismaBatchUpdateEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    BatchDelete: class extends PrismaBatchDeleteEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    BatchRestore: class extends PrismaBatchRestoreEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
    BatchUpsert: class extends PrismaBatchUpsertEndpoint<E, M> {
      _meta = meta;
      prisma = prisma;
    },
  } as PrismaCrudClasses<M, E>;
}
