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
  DrizzleAggregateEndpoint,
  DrizzleAuditLogStorage,
  DrizzleBatchCreateEndpoint,
  DrizzleBatchDeleteEndpoint,
  DrizzleBatchRestoreEndpoint,
  DrizzleBatchUpdateEndpoint,
  DrizzleBatchUpsertEndpoint,
  DrizzleBulkPatchEndpoint,
  DrizzleCloneEndpoint,
  DrizzleCreateEndpoint,
  type DrizzleDatabaseConstraint,
  DrizzleDeleteEndpoint,
  DrizzleExportEndpoint,
  DrizzleImportEndpoint,
  DrizzleListEndpoint,
  DrizzleReadEndpoint,
  DrizzleRestoreEndpoint,
  DrizzleSearchEndpoint,
  DrizzleUpdateEndpoint,
  DrizzleUpsertEndpoint,
  DrizzleVersionCompareEndpoint,
  DrizzleVersionHistoryEndpoint,
  DrizzleVersionReadEndpoint,
  DrizzleVersionRollbackEndpoint,
  DrizzleVersioningStorage,
  sqliteAuditLogTable,
  sqliteVersionHistoryTable,
} from '@hono-crud/drizzle';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  type HookContext,
  defineMeta,
  defineModel,
  defineModels,
  fromHono,
  registerCrud,
} from 'hono-crud';
import { setAuditStorage } from 'hono-crud/audit';
import { multiTenant } from 'hono-crud/multi-tenant';
import { setVersioningStorage } from 'hono-crud/versioning';
import { z } from 'zod';
import type {
  AdapterContext,
  AdapterDescriptor,
  ConformanceAuditEntry,
  HookRecorder,
} from '../contract';
import {
  CONFORMANCE_FILTER_CONFIG,
  buildConformanceSchema,
  buildEncryptionKeyProvider,
  buildEncryptionSchema,
} from '../model';

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

// Encryption fixture table. `secret` is a JSON-mode column: drizzle serializes
// the `{ ct, iv, v }` envelope (an object) to a JSON string on write and parses
// it back on read — the only column shape a SQL text column can hold an
// encrypted field in. A plain `text()` column would reject the object bind
// ("SQLite3 can only bind ... strings"), which is exactly why field encryption
// requires a JSON/serialized column on SQL adapters.
const encItemsTable = sqliteTable('conformance_enc', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').notNull().default('user'),
  age: integer('age'),
  secret: text('secret', { mode: 'json' }),
  version: integer('version'),
  deletedAt: text('deletedAt'),
  createdAt: integer('createdAt'),
  updatedAt: integer('updatedAt'),
});

// Durable version-history + audit tables backing the encrypted-consistency
// cells (encryptedHistoryAudit). Real SQL storages — DrizzleVersioningStorage
// and DrizzleAuditLogStorage — persist the plaintext snapshots / audit inputs
// that the cells read back, mirroring how the memory leg wires its in-process
// stores. One shared table each; rows are discriminated by the model tableName.
const versionHistoryTable = sqliteVersionHistoryTable();
const auditLogTable = sqliteAuditLogTable();
const versioningStore = new DrizzleVersioningStorage({ db: DB, table: versionHistoryTable });
const auditStore = new DrizzleAuditLogStorage({ db: DB, table: auditLogTable });

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

const ENC_TABLE = 'conformance_enc';
// Versioning + audit ride on the SAME enc model (the `version` column is an enc
// schema extension), mirroring the memory leg — so the encrypted-consistency
// cells can assert audit inputs, version-history snapshots, and rollback-at-rest
// all carry plaintext / valid historical ciphertext under field encryption.
const encSchema = buildEncryptionSchema('epoch-ms').extend({
  version: z.number().default(1),
});
const encModel = defineModel({
  tableName: ENC_TABLE,
  schema: encSchema,
  primaryKeys: ['id'],
  table: encItemsTable,
  softDelete: { field: 'deletedAt' },
  timestamps: true,
  versioning: { field: 'version', trackChangedBy: true, excludeFields: ['updatedAt'] },
  audit: {
    actions: ['create', 'update', 'delete', 'upsert'],
    trackChanges: true,
    storeRecord: true,
    storePreviousRecord: true,
    excludeFields: ['createdAt', 'updatedAt'],
  },
  fieldEncryption: { fields: ['secret'], keyProvider: buildEncryptionKeyProvider() },
});
const encMeta = defineMeta({ model: encModel });

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
class TenantBatchDelete extends DrizzleBatchDeleteEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantBatchUpdate extends DrizzleBatchUpdateEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantBatchRestore extends DrizzleBatchRestoreEndpoint {
  _meta = tenantMeta;
  db = DB;
}
class TenantAggregate extends DrizzleAggregateEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override filterFields = ['role'];
}
class TenantSearch extends DrizzleSearchEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override searchFields = ['name'];
  protected override filterFields = ['role'];
  protected override allowedIncludes = ['parent'];
}
class TenantExport extends DrizzleExportEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override filterFields = ['role'];
  protected override allowedIncludes = ['parent'];
}
class TenantBulkPatch extends DrizzleBulkPatchEndpoint {
  _meta = tenantMeta;
  db = DB;
  protected override filterFields = ['role'];
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

// Encryption endpoint classes — every write/returning verb on the enc model.
class EncCreate extends DrizzleCreateEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncRead extends DrizzleReadEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncList extends DrizzleListEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncUpdate extends DrizzleUpdateEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncDelete extends DrizzleDeleteEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncRestore extends DrizzleRestoreEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncUpsert extends DrizzleUpsertEndpoint {
  _meta = encMeta;
  db = DB;
  protected override upsertKeys = ['email'];
}
class EncClone extends DrizzleCloneEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncImport extends DrizzleImportEndpoint {
  _meta = encMeta;
  db = DB;
  protected override upsertKeys = ['email'];
}
class EncBatchCreate extends DrizzleBatchCreateEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncBatchUpdate extends DrizzleBatchUpdateEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncBatchUpsert extends DrizzleBatchUpsertEndpoint {
  _meta = encMeta;
  db = DB;
  protected override upsertKeys = ['email'];
}
class EncBatchDelete extends DrizzleBatchDeleteEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncBatchRestore extends DrizzleBatchRestoreEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncSearch extends DrizzleSearchEndpoint {
  _meta = encMeta;
  db = DB;
  protected override searchFields = ['name'];
}
class EncExport extends DrizzleExportEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncBulkPatch extends DrizzleBulkPatchEndpoint {
  _meta = encMeta;
  db = DB;
  protected override filterFields = ['role'];
  protected override returnRecords = true;
}
class EncVersionHistory extends DrizzleVersionHistoryEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncVersionRead extends DrizzleVersionReadEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncVersionCompare extends DrizzleVersionCompareEndpoint {
  _meta = encMeta;
  db = DB;
}
class EncVersionRollback extends DrizzleVersionRollbackEndpoint {
  _meta = encMeta;
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
// Model-registry graph (defineModels): a circular authors↔articles pair. Only
// the MODEL-level `table` is authored — the relation-level `table` each
// include needs is auto-populated by the factory from the sibling entry (the
// exact hand-duplication this leg previously required), and the friendly
// registry keys are rewritten to the physical table names.
// ============================================================================

const registryAuthorsTable = sqliteTable('registry_authors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
});
const registryArticlesTable = sqliteTable('registry_articles', {
  id: text('id').primaryKey(),
  authorId: text('authorId').notNull(),
  title: text('title').notNull(),
});

const registryAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
const registryArticleSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  title: z.string(),
});

const registryDb = defineModels({
  authors: {
    tableName: 'registry_authors',
    schema: registryAuthorSchema,
    primaryKeys: ['id'],
    table: registryAuthorsTable,
    relations: {
      articles: {
        type: 'hasMany',
        model: 'articles',
        foreignKey: 'authorId',
        nestedWrites: { allowCreate: true },
      },
    },
  },
  articles: {
    tableName: 'registry_articles',
    schema: registryArticleSchema,
    primaryKeys: ['id'],
    table: registryArticlesTable,
    relations: {
      author: { type: 'belongsTo', model: 'authors', foreignKey: 'authorId' },
    },
  },
});
const registryAuthorMeta = defineMeta({ model: registryDb.authors });
const registryArticleMeta = defineMeta({ model: registryDb.articles });

class RegistryAuthorCreate extends DrizzleCreateEndpoint {
  _meta = registryAuthorMeta;
  db = DB;
  protected override allowNestedCreate = ['articles'];
}
class RegistryAuthorRead extends DrizzleReadEndpoint {
  _meta = registryAuthorMeta;
  db = DB;
  protected override allowedIncludes = ['articles'];
}
class RegistryAuthorList extends DrizzleListEndpoint {
  _meta = registryAuthorMeta;
  db = DB;
  protected override allowedIncludes = ['articles'];
}
class RegistryArticleCreate extends DrizzleCreateEndpoint {
  _meta = registryArticleMeta;
  db = DB;
}
class RegistryArticleRead extends DrizzleReadEndpoint {
  _meta = registryArticleMeta;
  db = DB;
  protected override allowedIncludes = ['author'];
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
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS conformance_enc (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      age INTEGER,
      secret TEXT,
      version INTEGER,
      deletedAt TEXT,
      createdAt INTEGER,
      updatedAt INTEGER
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS version_history (
      id TEXT PRIMARY KEY,
      resource_table TEXT NOT NULL,
      record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      changed_by TEXT,
      change_reason TEXT,
      changes TEXT
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      user_id TEXT,
      record TEXT,
      previous_record TEXT,
      changes TEXT,
      metadata TEXT
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS registry_authors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS registry_articles (
      id TEXT PRIMARY KEY,
      authorId TEXT NOT NULL,
      title TEXT NOT NULL
    )
  `);
  await db.delete(itemsTable);
  await db.delete(encItemsTable);
  await db.delete(versionHistoryTable);
  await db.delete(auditLogTable);
  await db.delete(registryAuthorsTable);
  await db.delete(registryArticlesTable);
  // Only the enc model enables versioning/audit, so nothing else emits to these
  // durable stores; wire them globally and clear their rows per-cell in reset.
  setVersioningStorage(versioningStore);
  setAuditStorage(auditStore);
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
    batchUpdate: TenantBatchUpdate,
    batchDelete: TenantBatchDelete,
    batchRestore: TenantBatchRestore,
    aggregate: TenantAggregate,
    search: TenantSearch,
    export: TenantExport,
    bulkPatch: TenantBulkPatch,
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
  registerCrud(app, '/enc-items', {
    create: EncCreate,
    list: EncList,
    read: EncRead,
    update: EncUpdate,
    delete: EncDelete,
    restore: EncRestore,
    upsert: EncUpsert,
    clone: EncClone,
    import: EncImport,
    batchCreate: EncBatchCreate,
    batchUpdate: EncBatchUpdate,
    batchUpsert: EncBatchUpsert,
    batchDelete: EncBatchDelete,
    batchRestore: EncBatchRestore,
    search: EncSearch,
    export: EncExport,
    bulkPatch: EncBulkPatch,
    versionHistory: EncVersionHistory,
    versionRead: EncVersionRead,
    versionCompare: EncVersionCompare,
    versionRollback: EncVersionRollback,
  });
  registerCrud(app, '/registry-authors', {
    create: RegistryAuthorCreate,
    read: RegistryAuthorRead,
    list: RegistryAuthorList,
  });
  registerCrud(app, '/registry-articles', {
    create: RegistryArticleCreate,
    read: RegistryArticleRead,
  });
  // Serve the OpenAPI document so the model-registry cell can assert the
  // auto-populated include shapes through the HTTP surface.
  app.doc('/openapi.json', { info: { title: 'conformance', version: '1.0.0' } });

  return {
    app,
    hookRecorder: recorder,
    reset: async () => {
      await db.delete(itemsTable);
      await db.delete(encItemsTable);
      await db.delete(versionHistoryTable);
      await db.delete(auditLogTable);
      await db.delete(registryAuthorsTable);
      await db.delete(registryArticlesTable);
      resetRecorder();
    },
    teardown: async () => {
      client.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
    },
    // Raw SQL read of the JSON-mode `secret` column: libsql returns the stored
    // JSON string verbatim (never parsed/decrypted), so the cell sees exactly
    // what sits at rest.
    inspectStoredField: async (id, field) => {
      const row = await client.execute({
        sql: `SELECT ${field} AS value FROM conformance_enc WHERE id = ?`,
        args: [id],
      });
      return row.rows[0]?.value ?? undefined;
    },
    // Durable read-back: the audit rows are re-selected over SQL and rehydrated
    // (JSON payloads parsed), so the cell asserts against exactly what the
    // DrizzleAuditLogStorage persisted — not an in-memory mirror.
    inspectAudit: async () => (await auditStore.getAll()) as ConformanceAuditEntry[],
  };
}

export const drizzleConformance: AdapterDescriptor = {
  name: 'drizzle (libsql sqlite)',
  capabilities: {
    uniqueConstraints: true,
    timestampKind: 'epoch-ms',
    transactionalHooks: 'rollback',
    relationScoping: true,
    modelRegistry: true,
    batchTenantScoping: true,
    extendedVerbTenantScoping: true,
    fieldEncryption: true,
    // Enc leg wires DrizzleVersioningStorage + DrizzleAuditLogStorage (durable
    // SQL) plus the four version endpoints, so the encrypted-consistency cells
    // assert plaintext audit inputs / historical snapshots and valid
    // ciphertext-at-rest after rollback — against real cross-request storage.
    encryptedHistoryAudit: true,
    // Drizzle bulk-patch returns the patched rows (returnRecords = true on the
    // enc leg), so decrypt-on-return and per-record `bulk_patched` events work.
    bulkPatchReturnsRecords: true,
  },
  tenant: {
    field: 'tenantId',
    headerName: 'X-Tenant-ID',
    tenantA: 'tenant-a',
    tenantB: 'tenant-b',
  },
  setup,
};
