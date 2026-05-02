import type { Env } from 'hono';
import type { MetaInput } from '../../core/types';
import type { AdapterBundle } from '../../config/index';
import { type DrizzleDatabaseConstraint } from './helpers';
import {
  DrizzleCreateEndpoint,
  DrizzleReadEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  DrizzleRestoreEndpoint,
} from './crud';
import {
  DrizzleBatchCreateEndpoint,
  DrizzleBatchUpdateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
} from './batch';
import {
  DrizzleUpsertEndpoint,
  DrizzleBatchUpsertEndpoint,
} from './advanced';

/**
 * Return type of createDrizzleCrud factory function.
 * Provides type-safe base classes for all CRUD operations.
 */
type ConfiguredDrizzleEndpoint<TEndpoint, M extends MetaInput> = new () => TEndpoint & {
  _meta: M;
  db: DrizzleDatabaseConstraint;
};

export interface DrizzleCrudClasses<M extends MetaInput, E extends Env = Env> {
  Create: ConfiguredDrizzleEndpoint<DrizzleCreateEndpoint<E, M>, M>;
  Read: ConfiguredDrizzleEndpoint<DrizzleReadEndpoint<E, M>, M>;
  Update: ConfiguredDrizzleEndpoint<DrizzleUpdateEndpoint<E, M>, M>;
  Delete: ConfiguredDrizzleEndpoint<DrizzleDeleteEndpoint<E, M>, M>;
  List: ConfiguredDrizzleEndpoint<DrizzleListEndpoint<E, M>, M>;
  Restore: ConfiguredDrizzleEndpoint<DrizzleRestoreEndpoint<E, M>, M>;
  Upsert: ConfiguredDrizzleEndpoint<DrizzleUpsertEndpoint<E, M>, M>;
  BatchCreate: ConfiguredDrizzleEndpoint<DrizzleBatchCreateEndpoint<E, M>, M>;
  BatchUpdate: ConfiguredDrizzleEndpoint<DrizzleBatchUpdateEndpoint<E, M>, M>;
  BatchDelete: ConfiguredDrizzleEndpoint<DrizzleBatchDeleteEndpoint<E, M>, M>;
  BatchRestore: ConfiguredDrizzleEndpoint<DrizzleBatchRestoreEndpoint<E, M>, M>;
  BatchUpsert: ConfiguredDrizzleEndpoint<DrizzleBatchUpsertEndpoint<E, M>, M>;
}

/**
 * Creates a set of Drizzle CRUD endpoint base classes with db and meta pre-configured.
 * This is the cleanest pattern - no need to set `_meta` or `db` in your classes.
 *
 * @param db - Your Drizzle database instance
 * @param meta - The meta object (from defineMeta)
 * @returns Object with Create, Read, Update, Delete, List base classes
 *
 * @example
 * ```ts
 * import { createDrizzleCrud } from 'hono-crud/adapters/drizzle';
 *
 * const projectMeta = defineMeta({ model: ProjectModel, fields: projectSchemas.insert });
 * const Project = createDrizzleCrud(db, projectMeta);
 *
 * // Now define endpoints with minimal boilerplate:
 * class ProjectCreate extends Project.Create {
 *   schema = { tags: ["Projects"], summary: "Create a new project" };
 * }
 *
 * class ProjectList extends Project.List {
 *   schema = { tags: ["Projects"], summary: "List all projects" };
 *   protected searchFields = ["name", "clientName"];
 *   protected filterFields = ["status"];
 * }
 * ```
 */
export function createDrizzleCrud<M extends MetaInput, E extends Env = Env>(
  db: DrizzleDatabaseConstraint,
  meta: M
): DrizzleCrudClasses<M, E> {
  // Use type assertion to avoid TypeScript's anonymous class protected member restriction
  return {
    Create: class extends DrizzleCreateEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    Read: class extends DrizzleReadEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    Update: class extends DrizzleUpdateEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    Delete: class extends DrizzleDeleteEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    List: class extends DrizzleListEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    Restore: class extends DrizzleRestoreEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    Upsert: class extends DrizzleUpsertEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    BatchCreate: class extends DrizzleBatchCreateEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    BatchUpdate: class extends DrizzleBatchUpdateEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    BatchDelete: class extends DrizzleBatchDeleteEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    BatchRestore: class extends DrizzleBatchRestoreEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
    BatchUpsert: class extends DrizzleBatchUpsertEndpoint<E, M> {
      _meta = meta;
      db = db;
    },
  } as DrizzleCrudClasses<M, E>;
}

// ============================================================================
// Drizzle Adapters Bundle (for Config-based API)
// ============================================================================

/**
 * Drizzle adapter bundle for use with defineEndpoints.
 *
 * Note: When using DrizzleAdapters with defineEndpoints, you need to provide
 * your own base classes that extend the Drizzle endpoint classes and include
 * the `db` property. The config-based API cannot inject the database instance.
 *
 * @example
 * ```ts
 * import { defineEndpoints } from 'hono-crud';
 * import { DrizzleAdapters } from 'hono-crud/adapters/drizzle';
 *
 * // Create custom adapters with db injected
 * const MyDrizzleAdapters = {
 *   CreateEndpoint: class extends DrizzleCreateEndpoint { db = myDb; },
 *   ListEndpoint: class extends DrizzleListEndpoint { db = myDb; },
 *   ReadEndpoint: class extends DrizzleReadEndpoint { db = myDb; },
 *   UpdateEndpoint: class extends DrizzleUpdateEndpoint { db = myDb; },
 *   DeleteEndpoint: class extends DrizzleDeleteEndpoint { db = myDb; },
 * };
 *
 * const userEndpoints = defineEndpoints({ meta: userMeta, ... }, MyDrizzleAdapters);
 * ```
 */
export const DrizzleAdapters: AdapterBundle = {
  CreateEndpoint: DrizzleCreateEndpoint,
  ListEndpoint: DrizzleListEndpoint,
  ReadEndpoint: DrizzleReadEndpoint,
  UpdateEndpoint: DrizzleUpdateEndpoint,
  DeleteEndpoint: DrizzleDeleteEndpoint,
};
