/**
 * Memory adapter leg: in-process store, reset via `clearStorage()`.
 *
 * Capabilities:
 * - uniqueConstraints: false — the store has no constraint surface and the
 *   framework has no model-level unique declaration; the unique-conflict
 *   cell is skipped loudly.
 * - timestampKind: epoch-ms — library-managed (`Model.timestamps: true`).
 * - transactionalHooks: noop-sentinel — `MEMORY_NOOP_TX` is the documented
 *   feature-detectable contract; after-hook throws do not roll back.
 */
import {
  MEMORY_NOOP_TX,
  MemoryAggregateEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchRestoreEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryBatchUpsertEndpoint,
  MemoryBulkPatchEndpoint,
  MemoryCloneEndpoint,
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryExportEndpoint,
  MemoryImportEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemorySearchEndpoint,
  MemoryUpdateEndpoint,
  MemoryUpsertEndpoint,
  MemoryVersionCompareEndpoint,
  MemoryVersionHistoryEndpoint,
  MemoryVersionReadEndpoint,
  MemoryVersionRollbackEndpoint,
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  type HookContext,
  defineMeta,
  defineModel,
  defineModels,
  fromHono,
  registerCrud,
} from 'hono-crud';
import { MemoryAuditLogStorage, setAuditStorage } from 'hono-crud/audit';
import { multiTenant } from 'hono-crud/multi-tenant';
import { MemoryVersioningStorage, setVersioningStorage } from 'hono-crud/versioning';
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
// Schema + model variants
// ============================================================================

const schema = buildConformanceSchema('epoch-ms').extend({
  tenantId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});
type Item = z.infer<typeof schema>;

const TABLE = 'conformance_items';
const ENC_TABLE = 'conformance_enc';

const baseModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  timestamps: true,
});
const baseMeta = defineMeta({ model: baseModel });

const tenantModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  timestamps: true,
  multiTenant: { field: 'tenantId', source: 'context', contextKey: 'tenantId' },
  // Owner-scoped self-relation: a row's `parent` is filtered to the caller's
  // tenant + excludes soft-deleted parents (exercises the relation-include scope).
  relations: {
    parent: {
      type: 'belongsTo',
      model: TABLE,
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

// Field-encryption model: `secret` is AES-GCM encrypted at rest. The memory
// store keeps the `{ ct, iv, v }` envelope as a live object; the enc cell reads
// it back with `getStore` to prove no verb ever persists plaintext.
// Versioning + audit ride on the SAME memory enc model (the `version` column is
// a memory-only schema extension — the drizzle/prisma enc legs define their own
// schemas, so this does not touch them). This lets the encrypted-consistency
// cells assert audit inputs, version-history snapshots, and rollback-at-rest all
// carry plaintext / valid historical ciphertext under field encryption.
const encSchema = buildEncryptionSchema('epoch-ms').extend({
  version: z.number().default(1),
});
const encModel = defineModel({
  tableName: ENC_TABLE,
  schema: encSchema,
  primaryKeys: ['id'],
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
// Model-registry graph (defineModels): a circular authors↔articles pair with
// NO hand-supplied relation `schema`/`table` — the factory auto-populates both
// from the sibling entries and rewrites the friendly registry keys ('authors' /
// 'articles') to the physical table names the store resolves by.
// ============================================================================

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
    relations: {
      author: { type: 'belongsTo', model: 'authors', foreignKey: 'authorId' },
    },
  },
});
const registryAuthorMeta = defineMeta({ model: registryDb.authors });
const registryArticleMeta = defineMeta({ model: registryDb.articles });

// ============================================================================
// Endpoint classes
// ============================================================================

class ItemCreate extends MemoryCreateEndpoint {
  _meta = baseMeta;
}
class ItemRead extends MemoryReadEndpoint {
  _meta = baseMeta;
  protected override etagEnabled = true;
}
class ItemUpdate extends MemoryUpdateEndpoint {
  _meta = baseMeta;
  protected override etagEnabled = true;
}
class ItemDelete extends MemoryDeleteEndpoint {
  _meta = baseMeta;
}
class ItemRestore extends MemoryRestoreEndpoint {
  _meta = baseMeta;
}
class ItemList extends MemoryListEndpoint {
  _meta = baseMeta;
  protected override filterConfig = CONFORMANCE_FILTER_CONFIG;
  protected override sortFields = ['email'];
}
class ItemUpsert extends MemoryUpsertEndpoint {
  _meta = baseMeta;
  protected override upsertKeys = ['email'];
}
class ItemBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = baseMeta;
}
class ItemBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = baseMeta;
  protected override upsertKeys = ['email'];
}
class ItemBulkPatch extends MemoryBulkPatchEndpoint {
  _meta = baseMeta;
  protected override filterFields = ['role'];
}
class CursorItemList extends MemoryListEndpoint {
  _meta = baseMeta;
  protected override cursorPaginationEnabled = true;
  protected override cursorField = 'id';
  protected override sortFields = ['email'];
}

class RegistryAuthorCreate extends MemoryCreateEndpoint {
  _meta = registryAuthorMeta;
  protected override allowNestedCreate = ['articles'];
}
class RegistryAuthorRead extends MemoryReadEndpoint {
  _meta = registryAuthorMeta;
  protected override allowedIncludes = ['articles'];
}
class RegistryAuthorList extends MemoryListEndpoint {
  _meta = registryAuthorMeta;
  protected override allowedIncludes = ['articles'];
}
class RegistryArticleCreate extends MemoryCreateEndpoint {
  _meta = registryArticleMeta;
}
class RegistryArticleRead extends MemoryReadEndpoint {
  _meta = registryArticleMeta;
  protected override allowedIncludes = ['author'];
}

class TenantCreate extends MemoryCreateEndpoint {
  _meta = tenantMeta;
}
class TenantRead extends MemoryReadEndpoint {
  _meta = tenantMeta;
  protected override allowedIncludes = ['parent'];
}
class TenantUpdate extends MemoryUpdateEndpoint {
  _meta = tenantMeta;
}
class TenantDelete extends MemoryDeleteEndpoint {
  _meta = tenantMeta;
}
class TenantList extends MemoryListEndpoint {
  _meta = tenantMeta;
  protected override allowedIncludes = ['parent'];
}
class TenantBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = tenantMeta;
}
class TenantBatchUpdate extends MemoryBatchUpdateEndpoint {
  _meta = tenantMeta;
}
class TenantBatchRestore extends MemoryBatchRestoreEndpoint {
  _meta = tenantMeta;
}
class TenantAggregate extends MemoryAggregateEndpoint {
  _meta = tenantMeta;
  protected override filterFields = ['role'];
}
class TenantSearch extends MemorySearchEndpoint {
  _meta = tenantMeta;
  protected override searchFields = ['name'];
  protected override filterFields = ['role'];
  protected override allowedIncludes = ['parent'];
}
class TenantExport extends MemoryExportEndpoint {
  _meta = tenantMeta;
  protected override filterFields = ['role'];
  protected override allowedIncludes = ['parent'];
}
class TenantBulkPatch extends MemoryBulkPatchEndpoint {
  _meta = tenantMeta;
  protected override filterFields = ['role'];
}

class FinalizeCreate extends MemoryCreateEndpoint {
  _meta = finalizeMeta;
}
class FinalizeRead extends MemoryReadEndpoint {
  _meta = finalizeMeta;
}
class FinalizeList extends MemoryListEndpoint {
  _meta = finalizeMeta;
}
class FinalizeBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = finalizeMeta;
}
class FinalizeBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = finalizeMeta;
}

// Encryption endpoint classes — every write/returning verb on the enc model.
class EncCreate extends MemoryCreateEndpoint {
  _meta = encMeta;
}
class EncRead extends MemoryReadEndpoint {
  _meta = encMeta;
}
class EncList extends MemoryListEndpoint {
  _meta = encMeta;
}
class EncUpdate extends MemoryUpdateEndpoint {
  _meta = encMeta;
}
class EncDelete extends MemoryDeleteEndpoint {
  _meta = encMeta;
}
class EncRestore extends MemoryRestoreEndpoint {
  _meta = encMeta;
}
class EncUpsert extends MemoryUpsertEndpoint {
  _meta = encMeta;
  protected override upsertKeys = ['email'];
}
class EncClone extends MemoryCloneEndpoint {
  _meta = encMeta;
}
class EncImport extends MemoryImportEndpoint {
  _meta = encMeta;
  protected override upsertKeys = ['email'];
}
class EncBatchCreate extends MemoryBatchCreateEndpoint {
  _meta = encMeta;
}
class EncBatchUpdate extends MemoryBatchUpdateEndpoint {
  _meta = encMeta;
}
class EncBatchUpsert extends MemoryBatchUpsertEndpoint {
  _meta = encMeta;
  protected override upsertKeys = ['email'];
}
class EncBatchDelete extends MemoryBatchDeleteEndpoint {
  _meta = encMeta;
}
class EncBatchRestore extends MemoryBatchRestoreEndpoint {
  _meta = encMeta;
}
class EncSearch extends MemorySearchEndpoint {
  _meta = encMeta;
  protected override searchFields = ['name'];
}
class EncExport extends MemoryExportEndpoint {
  _meta = encMeta;
}
class EncBulkPatch extends MemoryBulkPatchEndpoint {
  _meta = encMeta;
  protected override filterFields = ['role'];
  protected override returnRecords = true;
}
class EncVersionHistory extends MemoryVersionHistoryEndpoint {
  _meta = encMeta;
}
class EncVersionRead extends MemoryVersionReadEndpoint {
  _meta = encMeta;
}
class EncVersionCompare extends MemoryVersionCompareEndpoint {
  _meta = encMeta;
}
class EncVersionRollback extends MemoryVersionRollbackEndpoint {
  _meta = encMeta;
}

// ============================================================================
// Hook instrumentation
// ============================================================================

const recorder: HookRecorder = { observations: [], failAfter: false };

function resetRecorder(): void {
  recorder.observations = [];
  recorder.failAfter = false;
}

// Version + audit stores for the encrypted-consistency cells. Globally wired in
// setup() (only the enc model enables versioning/audit, so nothing else emits to
// them); reset per-cell in the descriptor's `reset`.
const versioningStore = new MemoryVersioningStorage();
let auditStore = new MemoryAuditLogStorage();

class HookItemCreate extends MemoryCreateEndpoint {
  _meta = baseMeta;

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
  clearStorage();
  resetRecorder();
  versioningStore.clear();
  setVersioningStorage(versioningStore);
  auditStore = new MemoryAuditLogStorage();
  setAuditStorage(auditStore);

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
      clearStorage();
      resetRecorder();
      versioningStore.clear();
      auditStore = new MemoryAuditLogStorage();
      setAuditStorage(auditStore);
    },
    // Raw store read: the memory adapter keeps the encrypted envelope as a live
    // object, so the field is returned exactly as persisted (never decrypted).
    inspectStoredField: async (id, field) => {
      const row = getStore<Record<string, unknown>>(ENC_TABLE).get(id);
      return row?.[field];
    },
    inspectAudit: () => auditStore.getAllLogs() as ConformanceAuditEntry[],
  };
}

export const memoryConformance: AdapterDescriptor = {
  name: 'memory',
  capabilities: {
    uniqueConstraints: false,
    timestampKind: 'epoch-ms',
    transactionalHooks: 'noop-sentinel',
    relationScoping: true,
    modelRegistry: true,
    batchTenantScoping: true,
    extendedVerbTenantScoping: true,
    fieldEncryption: true,
    encryptedHistoryAudit: true,
    // Memory bulk-patch re-reads and returns the patched rows, so returnRecords,
    // decrypt-on-return, and per-record `bulk_patched` events all work.
    bulkPatchReturnsRecords: true,
  },
  tenant: {
    field: 'tenantId',
    headerName: 'X-Tenant-ID',
    tenantA: 'tenant-a',
    tenantB: 'tenant-b',
  },
  noopTxSentinel: MEMORY_NOOP_TX,
  setup,
};
