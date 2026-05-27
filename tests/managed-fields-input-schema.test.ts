/**
 * Engine-managed fields are excluded from every model-derived
 * request/input schema.
 *
 * 0.12.0 made `Model.id` + `Model.timestamps` engine-managed at the
 * adapter write sites but left them *required* in the batch / derived
 * input schemas (single-create stripped primary keys but not timestamps,
 * and the consumer-DTO override only masked that downstream). 0.12.1
 * centralizes the managed-field exclusion (`getManagedInputExclusions`)
 * and applies it to single create, batch create, update, batch update,
 * upsert, batch upsert and clone — symmetrically, with and without a
 * consumer body-schema override. Response/output schemas are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineModel,
  defineMeta,
  getManagedInputExclusions,
} from 'hono-crud';
import {
  MemoryCreateEndpoint,
  MemoryBatchCreateEndpoint,
  MemoryUpdateEndpoint,
  MemoryBatchUpdateEndpoint,
  MemoryUpsertEndpoint,
  MemoryBatchUpsertEndpoint,
  MemoryCloneEndpoint,
} from '@hono-crud/memory';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const FullSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  made_at: z.number().optional(),
  touched_at: z.number().optional(),
});

function metaFor(
  overrides: Record<string, unknown> = {},
  fields?: z.ZodObject
) {
  const model = defineModel({
    tableName: 'mf_items',
    schema: FullSchema,
    primaryKeys: ['id'],
    ...overrides,
  });
  return defineMeta(fields ? { model, fields } : { model });
}

/** Recursively collect every `properties` key-set from a JSON schema. */
function allPropKeys(jsonSchema: unknown): string[][] {
  const out: string[][] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.properties && typeof obj.properties === 'object') {
      out.push(Object.keys(obj.properties as Record<string, unknown>));
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(jsonSchema);
  return out;
}

function inputKeys(
  EP: new () => { _meta: unknown; upsertKeys?: string[]; getBodySchema: () => z.ZodTypeAny },
  meta: unknown,
  upsertKeys?: string[]
): string[] {
  const e = new EP();
  e._meta = meta;
  if (upsertKeys) e.upsertKeys = upsertKeys;
  const js = z.toJSONSchema(e.getBodySchema(), {
    io: 'input',
    unrepresentable: 'any',
  });
  // Flatten every nested property set into one bag of names.
  return [...new Set(allPropKeys(js).flat())];
}

const ENDPOINTS = {
  create: MemoryCreateEndpoint,
  batchCreate: MemoryBatchCreateEndpoint,
  update: MemoryUpdateEndpoint,
  batchUpdate: MemoryBatchUpdateEndpoint,
  upsert: MemoryUpsertEndpoint,
  batchUpsert: MemoryBatchUpsertEndpoint,
  clone: MemoryCloneEndpoint,
} as const;

// ----------------------------------------------------------------------------
// 1. timestamps:true + id generator => id / createdAt / updatedAt excluded
// ----------------------------------------------------------------------------

describe('managed-field exclusion: timestamps:true + id generator', () => {
  const meta = metaFor({ id: () => 'gen', timestamps: true });

  // When the PK is engine-generated the realistic upsert matches on a
  // natural key (`email`), so `id` is engine-managed there too.
  for (const name of ['create', 'batchCreate', 'update', 'batchUpsert'] as const) {
    it(`${name} input excludes id/createdAt/updatedAt`, () => {
      const keys = inputKeys(
        ENDPOINTS[name],
        meta,
        name === 'batchUpsert' ? ['email'] : undefined
      );
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('createdAt');
      expect(keys).not.toContain('updatedAt');
      // Non-managed fields are untouched.
      expect(keys).toContain('name');
      expect(keys).toContain('email');
    });
  }

  it('every family input schema excludes the managed timestamp fields', () => {
    // Timestamps are engine-managed at every write site, so they are
    // excluded from EVERY model-derived input schema.
    for (const [name, EP] of Object.entries(ENDPOINTS)) {
      const keys = inputKeys(
        EP,
        meta,
        name.toLowerCase().includes('upsert') ? ['email'] : undefined
      );
      expect(keys, name).not.toContain('createdAt');
      expect(keys, name).not.toContain('updatedAt');
    }
  });

  it('the model-derived payload never forces the generated primary key', () => {
    // create / batchCreate / clone strip the PK entirely (single-create
    // rule). batchUpdate keeps the outer `id` as the *lookup* (which
    // record to update) but the per-item `data` payload strips it.
    expect(inputKeys(MemoryCreateEndpoint, meta)).not.toContain('id');
    expect(inputKeys(MemoryBatchCreateEndpoint, meta)).not.toContain('id');
    expect(inputKeys(MemoryCloneEndpoint, meta)).not.toContain('id');

    // batchUpdate: drill specifically into the per-item `data` shape.
    const bu = new MemoryBatchUpdateEndpoint();
    bu._meta = meta as never;
    const bujs = z.toJSONSchema(bu.getBodySchema(), {
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    // items -> array -> object{ id, data } : the `data` props must not
    // contain id/createdAt/updatedAt.
    const dataProps = JSON.stringify(bujs).match(
      /"data":\{[^]*?"properties":\{([^}]*)\}/
    );
    expect(dataProps?.[1] ?? '').not.toContain('"id"');
    expect(dataProps?.[1] ?? '').not.toContain('"createdAt"');
    expect(dataProps?.[1] ?? '').not.toContain('"updatedAt"');
  });
});

// ----------------------------------------------------------------------------
// 2. Object-form timestamps => the RENAMED field names are excluded
// ----------------------------------------------------------------------------

describe('managed-field exclusion: object-form timestamps rename', () => {
  const meta = metaFor({
    timestamps: { createdAt: 'made_at', updatedAt: 'touched_at' },
  });

  it('excludes the renamed field names, not the defaults', () => {
    for (const [name, EP] of Object.entries(ENDPOINTS)) {
      const keys = inputKeys(
        EP,
        meta,
        name.toLowerCase().includes('upsert') ? ['email'] : undefined
      );
      expect(keys, name).not.toContain('made_at');
      expect(keys, name).not.toContain('touched_at');
      // Default names are plain (non-managed) schema fields here — kept.
      expect(keys, name).toContain('createdAt');
      expect(keys, name).toContain('updatedAt');
    }
  });

  it('getManagedInputExclusions resolves the renamed names via the normalized config', () => {
    const model = {
      primaryKeys: ['id'],
      id: 'uuid' as const,
      timestamps: { createdAt: 'made_at', updatedAt: 'touched_at' },
    };
    expect(getManagedInputExclusions(model).sort()).toEqual(
      ['id', 'made_at', 'touched_at'].sort()
    );
    // upsert opts out of PK exclusion
    expect(
      getManagedInputExclusions(model, { includePrimaryKeys: false }).sort()
    ).toEqual(['made_at', 'touched_at'].sort());
  });
});

// ----------------------------------------------------------------------------
// 3. timestamps unset + default id => unchanged (regression / backward-compat)
// ----------------------------------------------------------------------------

describe('regression: timestamps unset + default id (backward-compat)', () => {
  const meta = metaFor({});

  it('no timestamp exclusion; PK excluded exactly as single-create always did', () => {
    // No timestamps configured => no timestamp fields are stripped: the
    // bytes a 0.12.0 user gets when they don't use these features do not
    // change. `createdAt` / `updatedAt` here are plain schema fields and
    // must survive in every input schema.
    for (const [name, EP] of Object.entries(ENDPOINTS)) {
      const keys = inputKeys(
        EP,
        meta,
        name.toLowerCase().includes('upsert') ? ['email'] : undefined
      );
      expect(keys, name).toContain('name');
      expect(keys, name).toContain('createdAt');
      expect(keys, name).toContain('updatedAt');
    }
    // create / batchCreate / clone strip the PK (single-create invariant,
    // unchanged from pre-0.12.0).
    expect(inputKeys(MemoryCreateEndpoint, meta)).not.toContain('id');
    expect(inputKeys(MemoryBatchCreateEndpoint, meta)).not.toContain('id');
    expect(inputKeys(MemoryCloneEndpoint, meta)).not.toContain('id');
  });

  it('getManagedInputExclusions => only the primary key when no timestamps', () => {
    expect(
      getManagedInputExclusions({
        primaryKeys: ['id'],
        id: undefined,
        timestamps: undefined,
      })
    ).toEqual(['id']);
  });
});

// ----------------------------------------------------------------------------
// 4. Response/output schemas still INCLUDE id/createdAt/updatedAt
// ----------------------------------------------------------------------------

describe('response schemas keep the managed fields', () => {
  const meta = metaFor({ id: () => 'gen', timestamps: true });

  it('create 201 response still exposes id/createdAt/updatedAt', () => {
    const e = new MemoryCreateEndpoint();
    e._meta = meta as never;
    const schema =
      e.getSchema().responses![201].content!['application/json'].schema;
    const js = z.toJSONSchema(schema as z.ZodTypeAny, {
      io: 'output',
      unrepresentable: 'any',
    });
    const keys = [...new Set(allPropKeys(js).flat())];
    expect(keys).toContain('id');
    expect(keys).toContain('createdAt');
    expect(keys).toContain('updatedAt');
  });

  it('batchCreate 201 response still exposes the managed fields', () => {
    const e = new MemoryBatchCreateEndpoint();
    e._meta = meta as never;
    const schema =
      e.getSchema().responses![201].content!['application/json'].schema;
    const js = z.toJSONSchema(schema as z.ZodTypeAny, {
      io: 'output',
      unrepresentable: 'any',
    });
    const keys = [...new Set(allPropKeys(js).flat())];
    expect(keys).toContain('id');
    expect(keys).toContain('createdAt');
    expect(keys).toContain('updatedAt');
  });
});

// ----------------------------------------------------------------------------
// 5. Consumer-supplied per-endpoint body schema still wins
// ----------------------------------------------------------------------------

describe('consumer body-schema override takes precedence', () => {
  it('the override is used verbatim — managed-field exclusion does NOT rewrite it', () => {
    const Override = z.object({
      id: z.string(), // consumer explicitly wants the client to send id
      createdAt: z.number(), // and an explicit createdAt
      name: z.string(),
    });
    const meta = metaFor({ id: () => 'gen', timestamps: true }, Override);

    // single-create + update read `_meta.fields` directly.
    const createKeys = inputKeys(MemoryCreateEndpoint, meta);
    expect(createKeys).toEqual(
      expect.arrayContaining(['id', 'createdAt', 'name'])
    );

    const batchCreateKeys = inputKeys(MemoryBatchCreateEndpoint, meta);
    expect(batchCreateKeys).toEqual(
      expect.arrayContaining(['id', 'createdAt', 'name'])
    );

    const upsertKeys = inputKeys(MemoryUpsertEndpoint, meta);
    expect(upsertKeys).toEqual(
      expect.arrayContaining(['id', 'createdAt', 'name'])
    );
  });
});
