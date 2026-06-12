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
  MemoryBatchCreateEndpoint,
  MemoryBatchDeleteEndpoint,
  MemoryBatchUpsertEndpoint,
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  MemoryReadEndpoint,
  MemoryRestoreEndpoint,
  MemoryUpdateEndpoint,
  MemoryUpsertEndpoint,
  clearStorage,
} from '@hono-crud/memory';
import { OpenAPIHono } from '@hono/zod-openapi';
import { type HookContext, defineMeta, defineModel, fromHono, registerCrud } from 'hono-crud';
import { multiTenant } from 'hono-crud/multi-tenant';
import { z } from 'zod';
import type { AdapterContext, AdapterDescriptor, HookRecorder } from '../contract';
import { CONFORMANCE_FILTER_CONFIG, buildConformanceSchema } from '../model';

// ============================================================================
// Schema + model variants
// ============================================================================

const schema = buildConformanceSchema('epoch-ms').extend({
  tenantId: z.string().nullable().optional(),
});
type Item = z.infer<typeof schema>;

const TABLE = 'conformance_items';

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

class TenantCreate extends MemoryCreateEndpoint {
  _meta = tenantMeta;
}
class TenantRead extends MemoryReadEndpoint {
  _meta = tenantMeta;
}
class TenantUpdate extends MemoryUpdateEndpoint {
  _meta = tenantMeta;
}
class TenantDelete extends MemoryDeleteEndpoint {
  _meta = tenantMeta;
}
class TenantList extends MemoryListEndpoint {
  _meta = tenantMeta;
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
  registerCrud(app, '/hook-items', { create: HookItemCreate });

  return {
    app,
    hookRecorder: recorder,
    reset: async () => {
      clearStorage();
      resetRecorder();
    },
  };
}

export const memoryConformance: AdapterDescriptor = {
  name: 'memory',
  capabilities: {
    uniqueConstraints: false,
    timestampKind: 'epoch-ms',
    transactionalHooks: 'noop-sentinel',
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
