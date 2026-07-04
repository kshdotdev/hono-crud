/**
 * Prisma adapter leg: REAL PostgreSQL via the examples schema
 * (examples/prisma/schema.prisma, `users` table). Never mocked.
 *
 * Gated by DATABASE_URL in conformance.test.ts. Requires:
 *   pnpm run prisma:generate && pnpm run prisma:push
 * against the database DATABASE_URL points at (CI provisions Postgres 16 and
 * already runs both scripts in the test:examples step).
 *
 * Leg-specific mappings (the examples schema cannot be extended from here):
 * - timestamps are DB-managed (`@default(now())` / `@updatedAt`) → ISO
 *   strings, capability `timestampKind: 'iso-datetime'`.
 * - the tenant discriminator is the existing `status` enum column
 *   ('active' vs 'pending'); tenant enforcement is core-owned, so the
 *   adapter contract under test (faithful application of the injected
 *   equality filter) is identical to the other legs.
 *
 * All @prisma/client imports are dynamic and live inside setup() so that
 * collecting this file never requires a generated client.
 */
import {
  PrismaBatchCreateEndpoint,
  PrismaBatchDeleteEndpoint,
  PrismaBatchRestoreEndpoint,
  PrismaBatchUpdateEndpoint,
  PrismaBatchUpsertEndpoint,
  PrismaBulkPatchEndpoint,
  PrismaCloneEndpoint,
  PrismaCreateEndpoint,
  PrismaDeleteEndpoint,
  PrismaExportEndpoint,
  PrismaImportEndpoint,
  PrismaListEndpoint,
  PrismaReadEndpoint,
  PrismaRestoreEndpoint,
  PrismaSearchEndpoint,
  PrismaUpdateEndpoint,
  PrismaUpsertEndpoint,
  createPrismaCrud,
} from '@hono-crud/prisma';
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

/** Structural client type the @hono-crud/prisma endpoints accept. */
type HonoPrismaClient = Parameters<typeof createPrismaCrud>[0];

/** The slice of the generated client this leg actually drives directly. */
interface ConformancePrismaDb {
  $disconnect(): Promise<void>;
  user: { deleteMany(): Promise<unknown>; findFirst(): Promise<unknown> };
  post: { deleteMany(): Promise<unknown> };
  profile: { deleteMany(): Promise<unknown> };
  comment: { deleteMany(): Promise<unknown> };
  // Conformance encryption model (`enc_items`). `findUnique` reads the raw
  // stored `secret` Json — the `{ ct, iv, v }` envelope AT REST — bypassing the
  // hono-crud decrypt path (decrypt lives in the core endpoint layer, not in
  // Prisma), so the encryption cell sees exactly what sits in the column.
  encItem: {
    deleteMany(): Promise<unknown>;
    findUnique(args: {
      where: { id: string };
      select: { secret: true };
    }): Promise<{ secret: unknown } | null>;
  };
}

// ============================================================================
// Schema + model variants (examples/prisma/schema.prisma `users` table)
// ============================================================================

const schema = buildConformanceSchema('iso-datetime').extend({
  status: z.enum(['active', 'inactive', 'pending']).optional(),
});
type Item = z.infer<typeof schema>;

const TABLE = 'users';

const baseModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  // timestamps stay DB-managed: @default(now()) / @updatedAt in the schema.
});
const baseMeta = defineMeta({ model: baseModel });

const tenantModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  multiTenant: { field: 'status', source: 'context', contextKey: 'tenantId' },
});
const tenantMeta = defineMeta({ model: tenantModel });

const finalizeModel = defineModel({
  tableName: TABLE,
  schema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  serializationProfile: { name: 'conformance', exclude: ['age'] },
  computedFields: {
    nameUpper: {
      schema: z.string(),
      compute: (record: Item) => record.name.toUpperCase(),
    },
  },
});
const finalizeMeta = defineMeta({ model: finalizeModel });

// Field-encryption model (examples/prisma/schema.prisma `enc_items` table).
// `secret` is a `Json?` column: Prisma serializes the `{ ct, iv, v }` envelope
// (an object) into it and returns it verbatim on read — the JSON-capable column
// shape a SQL adapter needs to hold an encrypted field. Timestamps stay
// DB-managed (@default(now()) / @updatedAt), matching the base prisma model.
// Versioning + audit are NOT wired here (mirroring the drizzle leg): the
// encrypted-consistency cells skip loudly via `encryptedHistoryAudit: false`.
const ENC_TABLE = 'enc_items';
const encSchema = buildEncryptionSchema('iso-datetime');
const encModel = defineModel({
  tableName: ENC_TABLE,
  schema: encSchema,
  primaryKeys: ['id'],
  softDelete: { field: 'deletedAt' },
  fieldEncryption: { fields: ['secret'], keyProvider: buildEncryptionKeyProvider() },
});
const encMeta = defineMeta({ model: encModel });

// ============================================================================
// Hook instrumentation
// ============================================================================

const recorder: HookRecorder = { observations: [], failAfter: false };

function resetRecorder(): void {
  recorder.observations = [];
  recorder.failAfter = false;
}

// ============================================================================
// Descriptor
// ============================================================================

async function setup(): Promise<AdapterContext> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('conformance prisma leg requires DATABASE_URL');
  }

  const adapterPgModule = (await import('@prisma/adapter-pg')) as unknown as {
    PrismaPg: new (options: { connectionString: string }) => unknown;
  };
  const prismaModule = (await import('@prisma/client')) as unknown as {
    PrismaClient: new (options: { adapter: unknown }) => ConformancePrismaDb;
  };

  const adapter = new adapterPgModule.PrismaPg({ connectionString: url });
  const db = new prismaModule.PrismaClient({ adapter });
  const crudClient = db as unknown as HonoPrismaClient;

  try {
    await db.user.findFirst();
  } catch (error) {
    await db.$disconnect();
    throw new Error(
      `conformance prisma leg: could not query the \`users\` table. Run \`pnpm run prisma:generate && pnpm run prisma:push\` against DATABASE_URL (${url}) first.`,
      { cause: error },
    );
  }

  // ==========================================================================
  // Endpoint classes (need the live client, hence defined in setup scope)
  // ==========================================================================

  class ItemCreate extends PrismaCreateEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
  }
  class ItemRead extends PrismaReadEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override etagEnabled = true;
  }
  class ItemUpdate extends PrismaUpdateEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override etagEnabled = true;
  }
  class ItemDelete extends PrismaDeleteEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
  }
  class ItemRestore extends PrismaRestoreEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
  }
  class ItemList extends PrismaListEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override filterConfig = CONFORMANCE_FILTER_CONFIG;
    protected override sortFields = ['email'];
  }
  class ItemUpsert extends PrismaUpsertEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override upsertKeys = ['email'];
  }
  class ItemBatchCreate extends PrismaBatchCreateEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
  }
  class ItemBatchUpsert extends PrismaBatchUpsertEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override upsertKeys = ['email'];
  }
  class ItemBulkPatch extends PrismaBulkPatchEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override filterFields = ['role'];
  }
  class CursorItemList extends PrismaListEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
    protected override cursorPaginationEnabled = true;
    protected override cursorField = 'id';
    protected override sortFields = ['email'];
  }

  class TenantCreate extends PrismaCreateEndpoint {
    _meta = tenantMeta;
    prisma = crudClient;
  }
  class TenantRead extends PrismaReadEndpoint {
    _meta = tenantMeta;
    prisma = crudClient;
  }
  class TenantUpdate extends PrismaUpdateEndpoint {
    _meta = tenantMeta;
    prisma = crudClient;
  }
  class TenantDelete extends PrismaDeleteEndpoint {
    _meta = tenantMeta;
    prisma = crudClient;
  }
  class TenantList extends PrismaListEndpoint {
    _meta = tenantMeta;
    prisma = crudClient;
  }

  class FinalizeCreate extends PrismaCreateEndpoint {
    _meta = finalizeMeta;
    prisma = crudClient;
  }
  class FinalizeRead extends PrismaReadEndpoint {
    _meta = finalizeMeta;
    prisma = crudClient;
  }
  class FinalizeList extends PrismaListEndpoint {
    _meta = finalizeMeta;
    prisma = crudClient;
  }
  class FinalizeBatchCreate extends PrismaBatchCreateEndpoint {
    _meta = finalizeMeta;
    prisma = crudClient;
  }
  class FinalizeBatchDelete extends PrismaBatchDeleteEndpoint {
    _meta = finalizeMeta;
    prisma = crudClient;
  }

  class HookItemCreate extends PrismaCreateEndpoint {
    _meta = baseMeta;
    prisma = crudClient;
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

  // Encryption endpoint classes — mirror the drizzle enc leg's verb family
  // (every write/returning verb) so the encryption + events cells run. No
  // version endpoints (encryptedHistoryAudit is false; drizzle now wires them
  // and is true, so this prisma leg is the sole false leg).
  class EncCreate extends PrismaCreateEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncRead extends PrismaReadEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncList extends PrismaListEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncUpdate extends PrismaUpdateEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncDelete extends PrismaDeleteEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncRestore extends PrismaRestoreEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncUpsert extends PrismaUpsertEndpoint {
    _meta = encMeta;
    prisma = crudClient;
    protected override upsertKeys = ['email'];
  }
  class EncClone extends PrismaCloneEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncImport extends PrismaImportEndpoint {
    _meta = encMeta;
    prisma = crudClient;
    protected override upsertKeys = ['email'];
  }
  class EncBatchCreate extends PrismaBatchCreateEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncBatchUpdate extends PrismaBatchUpdateEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncBatchUpsert extends PrismaBatchUpsertEndpoint {
    _meta = encMeta;
    prisma = crudClient;
    protected override upsertKeys = ['email'];
  }
  class EncBatchDelete extends PrismaBatchDeleteEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncBatchRestore extends PrismaBatchRestoreEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  class EncSearch extends PrismaSearchEndpoint {
    _meta = encMeta;
    prisma = crudClient;
    protected override searchFields = ['name'];
  }
  class EncExport extends PrismaExportEndpoint {
    _meta = encMeta;
    prisma = crudClient;
  }
  // Prisma bulk-patch is a count-only `updateMany`: it surfaces no rows, so
  // `returnRecords` is unsupported and NO `bulk_patched` events fire. That
  // divergence is PINNED by cells/events.ts (zero-events) and the
  // `bulkPatchReturnsRecords: false` capability — never "fixed" here.
  class EncBulkPatch extends PrismaBulkPatchEndpoint {
    _meta = encMeta;
    prisma = crudClient;
    protected override filterFields = ['role'];
  }

  const reset = async (): Promise<void> => {
    // Dependency order mirrors examples/prisma/db.ts clearDb().
    await db.comment.deleteMany();
    await db.post.deleteMany();
    await db.profile.deleteMany();
    await db.user.deleteMany();
    await db.encItem.deleteMany();
    resetRecorder();
  };
  await reset();

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
    reset,
    teardown: async () => {
      await db.$disconnect();
    },
    // Raw read of the `secret` Json column via the Prisma client directly (never
    // the hono-crud decrypt path): Postgres returns the stored `{ ct, iv, v }`
    // envelope as a JS object, so the cell sees exactly what sits at rest.
    inspectStoredField: async (id, field) => {
      if (field !== 'secret') {
        throw new Error(
          `prisma conformance leg can only inspect the \`secret\` field, got ${field}`,
        );
      }
      const row = await db.encItem.findUnique({ where: { id }, select: { secret: true } });
      return row?.secret ?? undefined;
    },
  };
}

export const prismaConformance: AdapterDescriptor = {
  name: 'prisma (postgres)',
  capabilities: {
    uniqueConstraints: true,
    timestampKind: 'iso-datetime',
    transactionalHooks: 'rollback',
    // The prisma leg reuses the fixed examples `users` schema, which has no
    // self-relation column — the relation-scoping cell is a named skip here.
    relationScoping: false,
    // No batch verbs are registered on the prisma tenant variant; the
    // batch owner-scoping cell is a named skip here.
    batchTenantScoping: false,
    // Likewise the extended read/bulk verbs (aggregate/search/export/bulkPatch)
    // are not registered on the prisma tenant variant; the extended-verb
    // owner-scoping cell is a named skip here.
    extendedVerbTenantScoping: false,
    // The prisma leg wires a dedicated `enc_items` model whose `secret` is a
    // `Json?` column — it holds the `{ ct, iv, v }` envelope an encrypted field
    // serializes to — so the field-encryption + event cells RUN here (mirroring
    // the drizzle leg). The raw at-rest value is read via `inspectStoredField`.
    fieldEncryption: true,
    // The enc leg wires no version endpoints / inspectable audit store (same as
    // drizzle) -> the encrypted-consistency cells (audit/version/rollback under
    // encryption) skip loudly. The fix is core/adapter-agnostic and anchored on
    // the memory leg + the core unit suite.
    encryptedHistoryAudit: false,
    // Prisma bulk-patch is a count-only `updateMany` that surfaces no rows, so
    // no `bulk_patched` events fire and `returnRecords` is unsupported. Pinned
    // by the prisma-only zero-events cell; never "fixed".
    bulkPatchReturnsRecords: false,
  },
  tenant: {
    field: 'status',
    headerName: 'X-Tenant-ID',
    tenantA: 'active',
    tenantB: 'pending',
  },
  setup,
};
