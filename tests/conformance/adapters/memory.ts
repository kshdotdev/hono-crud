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
  clearStorage,
  getStore,
} from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { type HookContext, defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { multiTenant } from 'hono-crud/multi-tenant';
import { z } from 'zod';
import type { AdapterContext, AdapterDescriptor, HookRecorder } from '../contract';
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
const encSchema = buildEncryptionSchema('epoch-ms');
const encModel = defineModel({
  tableName: ENC_TABLE,
  schema: encSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  timestamps: true,
  fieldEncryption: { fields: ['secret'], keyProvider: buildEncryptionKeyProvider() },
});
const encMeta = defineMeta({ model: encModel });

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

// ============================================================================
// Hook instrumentation
// ============================================================================

const recorder: HookRecorder = { observations: [], failAfter: false };

function resetRecorder(): void {
  recorder.observations = [];
  recorder.failAfter = false;
}

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
  });

  return {
    app,
    hookRecorder: recorder,
    reset: async () => {
      clearStorage();
      resetRecorder();
    },
    // Raw store read: the memory adapter keeps the encrypted envelope as a live
    // object, so the field is returned exactly as persisted (never decrypted).
    inspectStoredField: async (id, field) => {
      const row = getStore<Record<string, unknown>>(ENC_TABLE).get(id);
      return row?.[field];
    },
  };
}

export const memoryConformance: AdapterDescriptor = {
  name: 'memory',
  capabilities: {
    uniqueConstraints: false,
    timestampKind: 'epoch-ms',
    transactionalHooks: 'noop-sentinel',
    relationScoping: true,
    batchTenantScoping: true,
    extendedVerbTenantScoping: true,
    fieldEncryption: true,
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
