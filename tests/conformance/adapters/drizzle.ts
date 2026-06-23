import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Drizzle adapter leg: real SQL on libsql over a throwaway sqlite file
 * (the tests/drizzle.test.ts `:memory:` fixture, adapted — see the database
 * fixture note below for why `:memory:` cannot host the transaction cell).
 *
 * Capabilities:
 * - uniqueConstraints: true — `email` carries a real UNIQUE constraint;
 *   violations surface through core's `mapUniqueViolation` as 409 CONFLICT.
 * - timestampKind: epoch-ms — library-managed (`Model.timestamps: true`).
 * - transactionalHooks: rollback — `useTransaction = true` wraps the verb in
 *   `db.transaction(...)`; an after-hook throw rolls the INSERT back.
 */
import {
  DrizzleBatchCreateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleBulkPatchEndpoint,
  DrizzleCreateEndpoint,
  type DrizzleDatabaseConstraint,
  DrizzleDeleteEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  DrizzleRestoreEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleUpsertEndpoint,
} from '@hono-crud/drizzle';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type HookContext, defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { multiTenant } from 'hono-crud/multi-tenant';
import { z } from 'zod';
import type { AdapterContext, AdapterDescriptor, HookRecorder } from '../contract';
import { CONFORMANCE_FILTER_CONFIG, buildConformanceSchema } from '../model';

// ============================================================================
// Database fixture
//
// File-backed sqlite (NOT `:memory:` like tests/drizzle.test.ts): the
// transactional-hooks cell drives REAL `db.transaction(...)`, and libsql
// serves transactions over a separate connection — with `:memory:` that
// leaves the primary connection pointing at a fresh empty database after the
// first transaction. A throwaway temp file keeps real cross-connection
// transaction semantics; teardown removes it.
// ============================================================================

const databaseDirectory = mkdtempSync(join(tmpdir(), 'hono-crud-conformance-'));
const databasePath = join(databaseDirectory, 'drizzle.db');
const client = createClient({ url: `file:${databasePath}` });
const db = drizzle(client);
const DB = db as unknown as DrizzleDatabaseConstraint;

const itemsTable = sqliteTable('conformance_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').notNull().default('user'),
  age: integer('age'),
  tenantId: text('tenantId'),
  parentId: text('parentId'),
  deletedAt: text('deletedAt'),
  createdAt: integer('createdAt'),
  updatedAt: integer('updatedAt'),
});

// ============================================================================
// Schema + model variants
// ============================================================================

const schema = buildConformanceSchema('epoch-ms').extend({
  tenantId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});
type Item = z.infer<typeof schema>;

const TABLE = 'conformance_items';

const baseModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  table: itemsTable,
  softDelete: { field: 'deletedAt' },
  timestamps: true,
});
const baseMeta = defineMeta({ model: baseModel });

const tenantModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  table: itemsTable,
  softDelete: { field: 'deletedAt' },
  timestamps: true,
  multiTenant: { field: 'tenantId', source: 'context', contextKey: 'tenantId' },
  // Owner-scoped self-relation: a row's `parent` is filtered to the caller's
  // tenant + excludes soft-deleted parents — the include scope pushes these into
  // the SQL WHERE (see drizzle helpers `fetchRelated`).
  relations: {
    parent: {
      type: 'belongsTo',
      model: TABLE,
      table: itemsTable,
      foreignKey: 'parentId',
      localKey: 'id',
      schema,
      scope: { tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    },
  },
});
const tenantMeta = defineMeta({ model: tenantModel });

const finalizeModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  table: itemsTable,
  softDelete: { field: 'deletedAt' },
  timestamps: true,
  serializationProfile: { name: 'conformance', exclude: ['age'] },
  computedFields: {
    nameUpper: {
      schema: z.string(),
      compute: (record: Item) => record.name.toUpperCase(),
    },
  },
});
const finalizeMeta = defineMeta({ model: finalizeModel });

// ============================================================================
// Endpoint classes
// ============================================================================

class ItemCreate extends DrizzleCreateEndpoint {
  _meta = baseMeta;
  db = DB;
}
class ItemRead extends DrizzleReadEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override etagEnabled = true;
}
class ItemUpdate extends DrizzleUpdateEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override etagEnabled = true;
}
class ItemDelete extends DrizzleDeleteEndpoint {
  _meta = baseMeta;
  db = DB;
}
class ItemRestore extends DrizzleRestoreEndpoint {
  _meta = baseMeta;
  db = DB;
}
class ItemList extends DrizzleListEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override filterConfig = CONFORMANCE_FILTER_CONFIG;
  protected override sortFields = ['email'];
}
class ItemUpsert extends DrizzleUpsertEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override upsertKeys = ['email'];
}
class ItemBatchCreate extends DrizzleBatchCreateEndpoint {
  _meta = baseMeta;
  db = DB;
}
class ItemBatchUpsert extends DrizzleBatchUpsertEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override upsertKeys = ['email'];
}
class ItemBulkPatch extends DrizzleBulkPatchEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override filterFields = ['role'];
}
class CursorItemList extends DrizzleListEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override cursorPaginationEnabled = true;
  protected override cursorField = 'id';
  protected override sortFields = ['email'];
}

class TenantCreate extends DrizzleCreateEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantRead extends DrizzleReadEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override allowedIncludes = ['parent'];
}
class TenantUpdate extends DrizzleUpdateEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantDelete extends DrizzleDeleteEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantList extends DrizzleListEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override allowedIncludes = ['parent'];
}

class FinalizeCreate extends DrizzleCreateEndpoint {
  _meta = finalizeMeta;
  db = DB;
}
class FinalizeRead extends DrizzleReadEndpoint {
  _meta = finalizeMeta;
  db = DB;
}
class FinalizeList extends DrizzleListEndpoint {
  _meta = finalizeMeta;
  db = DB;
}
class FinalizeBatchCreate extends DrizzleBatchCreateEndpoint {
  _meta = finalizeMeta;
  db = DB;
}
class FinalizeBatchDelete extends DrizzleBatchDeleteEndpoint {
  _meta = finalizeMeta;
  db = DB;
}

// ============================================================================
// Hook instrumentation
// ============================================================================

const recorder: HookRecorder = { observations: [], failAfter: false };

function resetRecorder(): void {
  recorder.observations = [];
  recorder.failAfter = false;
}

class HookItemCreate extends DrizzleCreateEndpoint {
  _meta = baseMeta;
  db = DB;
  protected override useTransaction = true;

  override async before(
    data: Record<string, unknown>,
    hookCtx: HookContext,
  ): Promise<Record<string, unknown>> {
    recorder.observations.push({ phase: 'before', data: { ...data }, tx: hookCtx.db.tx });
    return data;
  }

  override async after(
    data: Record<string, unknown>,
    hookCtx: HookContext,
  ): Promise<Record<string, unknown>> {
    recorder.observations.push({ phase: 'after', data: { ...data }, tx: hookCtx.db.tx });
    if (recorder.failAfter) {
      throw new Error('conformance: deliberate after-hook failure');
    }
    return data;
  }
}

// ============================================================================
// Descriptor
// ============================================================================

async function setup(): Promise<AdapterContext> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS conformance_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      age INTEGER,
      tenantId TEXT,
      parentId TEXT,
      deletedAt TEXT,
      createdAt INTEGER,
      updatedAt INTEGER
    )
  `);
  await db.delete(itemsTable);
  resetRecorder();

  // NOTE: must be an OpenAPIHono — `fromHono(new Hono())` builds a fresh
  // internal router and DISCARDS the passed instance, so middleware
  // registered on a plain Hono would never run.
  const raw = new OpenAPIHono();
  raw.use('/tenant-items', multiTenant({ contextKey: 'tenantId' }));
  raw.use('/tenant-items/*', multiTenant({ contextKey: 'tenantId' }));
  const app = fromHono(raw);

  registerCrud(app, '/items', {
    create: ItemCreate,
    list: ItemList,
    read: ItemRead,
    update: ItemUpdate,
    delete: ItemDelete,
    restore: ItemRestore,
    upsert: ItemUpsert,
    batchCreate: ItemBatchCreate,
    batchUpsert: ItemBatchUpsert,
    bulkPatch: ItemBulkPatch,
  });
  registerCrud(app, '/tenant-items', {
    create: TenantCreate,
    list: TenantList,
    read: TenantRead,
    update: TenantUpdate,
    delete: TenantDelete,
  });
  registerCrud(app, '/finalize-items', {
    create: FinalizeCreate,
    list: FinalizeList,
    read: FinalizeRead,
    batchCreate: FinalizeBatchCreate,
    batchDelete: FinalizeBatchDelete,
  });
  registerCrud(app, '/cursor-items', { create: ItemCreate, list: CursorItemList });
  registerCrud(app, '/hook-items', { create: HookItemCreate });

  return {
    app,
    hookRecorder: recorder,
    reset: async () => {
      await db.delete(itemsTable);
      resetRecorder();
    },
    teardown: async () => {
      client.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
    },
  };
}

export const drizzleConformance: AdapterDescriptor = {
  name: 'drizzle (libsql sqlite)',
  capabilities: {
    uniqueConstraints: true,
    timestampKind: 'epoch-ms',
    transactionalHooks: 'rollback',
    relationScoping: true,
  },
  tenant: {
    field: 'tenantId',
    headerName: 'X-Tenant-ID',
    tenantA: 'tenant-a',
    tenantB: 'tenant-b',
  },
  setup,
};
