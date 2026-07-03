import type { Env } from 'hono';
import { type MetaInput, resolveSchemaTags } from 'hono-crud/internal';
import {
  MemoryAggregateEndpoint,
  MemoryCloneEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemorySearchEndpoint,
  MemoryUpsertEndpoint,
} from './advanced';
import {
  MemoryBatchCreateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchUpsertEndpoint,
} from './batch';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemoryUpdateEndpoint,
} from './crud';

/**
 * Return type of createMemoryCrud factory function.
 * Provides type-safe base classes for all CRUD operations.
 *
 * Unlike the drizzle/prisma factories, the memory adapter has no database
 * handle to bind — the endpoints share a process-global store — so the
 * configured classes stamp only `_meta`.
 */
type ConfiguredMemoryEndpoint<TEndpoint, M extends MetaInput> = new () => TEndpoint & {
  _meta: M;
};

export interface MemoryCrudClasses<M extends MetaInput, E extends Env = Env> {
  Create: ConfiguredMemoryEndpoint<MemoryCreateEndpoint<E, M>, M>;
  Read: ConfiguredMemoryEndpoint<MemoryReadEndpoint<E, M>, M>;
  Update: ConfiguredMemoryEndpoint<MemoryUpdateEndpoint<E, M>, M>;
  Delete: ConfiguredMemoryEndpoint<MemoryDeleteEndpoint<E, M>, M>;
  List: ConfiguredMemoryEndpoint<MemoryListEndpoint<E, M>, M>;
  Restore: ConfiguredMemoryEndpoint<MemoryRestoreEndpoint<E, M>, M>;
  Upsert: ConfiguredMemoryEndpoint<MemoryUpsertEndpoint<E, M>, M>;
  Search: ConfiguredMemoryEndpoint<MemorySearchEndpoint<E, M>, M>;
  Aggregate: ConfiguredMemoryEndpoint<MemoryAggregateEndpoint<E, M>, M>;
  Export: ConfiguredMemoryEndpoint<MemoryExportEndpoint<E, M>, M>;
  Import: ConfiguredMemoryEndpoint<MemoryImportEndpoint<E, M>, M>;
  Clone: ConfiguredMemoryEndpoint<MemoryCloneEndpoint<E, M>, M>;
  BatchCreate: ConfiguredMemoryEndpoint<MemoryBatchCreateEndpoint<E, M>, M>;
  BatchUpdate: ConfiguredMemoryEndpoint<MemoryBatchUpdateEndpoint<E, M>, M>;
  BatchDelete: ConfiguredMemoryEndpoint<MemoryBatchDeleteEndpoint<E, M>, M>;
  BatchRestore: ConfiguredMemoryEndpoint<MemoryBatchRestoreEndpoint<E, M>, M>;
  BatchUpsert: ConfiguredMemoryEndpoint<MemoryBatchUpsertEndpoint<E, M>, M>;
}

/**
 * Creates a set of in-memory CRUD endpoint base classes with meta pre-configured.
 * This is the cleanest pattern - no need to set `_meta` in your classes, and
 * OpenAPI `tags` default from the model's `tag` (or `tableName`).
 *
 * @param meta - The meta object (from defineMeta)
 * @returns Object with Create, Read, Update, Delete, List, ... base classes
 *
 * @example
 * ```ts
 * import { createMemoryCrud } from '@hono-crud/memory';
 *
 * // `tag` on the model becomes the default OpenAPI group for every endpoint,
 * // so subclasses no longer restate `tags` (an explicit `schema.tags` still wins).
 * const UserModel = defineModel({ tableName: 'users', tag: 'Users', schema, primaryKeys: ['id'] });
 * const userMeta = defineMeta({ model: UserModel });
 * const User = createMemoryCrud(userMeta);
 *
 * // Now define endpoints with minimal boilerplate:
 * class UserCreate extends User.Create {
 *   schema = { summary: "Create a new user" };
 * }
 *
 * class UserList extends User.List {
 *   schema = { summary: "List all users" };
 *   protected searchFields = ["name", "email"];
 *   protected filterFields = ["role"];
 * }
 * ```
 */
export function createMemoryCrud<M extends MetaInput, E extends Env = Env>(
  meta: M,
): MemoryCrudClasses<M, E> {
  // Use type assertion to avoid TypeScript's anonymous class protected member restriction
  return {
    Create: class extends MemoryCreateEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Read: class extends MemoryReadEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Update: class extends MemoryUpdateEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Delete: class extends MemoryDeleteEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    List: class extends MemoryListEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Restore: class extends MemoryRestoreEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Upsert: class extends MemoryUpsertEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Search: class extends MemorySearchEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Aggregate: class extends MemoryAggregateEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Export: class extends MemoryExportEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Import: class extends MemoryImportEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    Clone: class extends MemoryCloneEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    BatchCreate: class extends MemoryBatchCreateEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    BatchUpdate: class extends MemoryBatchUpdateEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    BatchDelete: class extends MemoryBatchDeleteEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    BatchRestore: class extends MemoryBatchRestoreEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
    BatchUpsert: class extends MemoryBatchUpsertEndpoint<E, M> {
      _meta = meta;
      override getSchema() {
        return resolveSchemaTags(super.getSchema(), meta.model);
      }
    },
  } as MemoryCrudClasses<M, E>;
}
