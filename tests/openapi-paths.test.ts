import { MemoryAdapters } from '@hono-crud/memory';
import {
  describe,
  it,
  expect } from 'vitest';
import { z } from 'zod';
import {
  defineEndpoints,
  defineMeta,
  defineModel,
  toOpenApiPaths,
} from 'hono-crud';

// ============================================================================
// Fixtures
// ============================================================================

const ProductSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  sku: z.string(),
  inStock: z.boolean().default(true),
});

const ProductModel = defineModel({
  tableName: 'products',
  schema: ProductSchema,
  primaryKeys: ['id'],
});

const productMeta = defineMeta({ model: ProductModel });

/** A full-featured config exercising every enabled endpoint slot. */
function fullEndpoints() {
  return defineEndpoints(
    {
      meta: productMeta,
      create: { openapi: { summary: 'Create product' } },
      list: {
        filtering: { fields: ['sku'] },
        pagination: { defaultPerPage: 25, maxPerPage: 100 },
      },
      read: {},
      update: {},
      delete: {},
      search: { fields: ['name', 'sku'] },
      aggregate: {},
      upsert: { conflictTarget: 'sku' },
      restore: {},
      clone: {},
      export: {},
      import: {},
      batchCreate: {},
      batchUpdate: {},
      batchDelete: {},
      batchRestore: {},
      batchUpsert: { conflictTarget: 'sku' },
    },
    MemoryAdapters
  );
}

// ============================================================================
// 1. Full-featured model: every enabled endpoint emitted with populated
//    request/response schemas.
// ============================================================================

describe('toOpenApiPaths — completeness', () => {
  it('emits a path item for every enabled endpoint (all 17 verbs)', () => {
    const paths = toOpenApiPaths(fullEndpoints());

    // Collection root
    expect(paths['/']?.post).toBeDefined(); // create
    expect(paths['/']?.get).toBeDefined(); // list
    // Named collection sub-routes
    expect(paths['/batch']?.post).toBeDefined(); // batchCreate
    expect(paths['/batch']?.patch).toBeDefined(); // batchUpdate
    expect(paths['/batch']?.delete).toBeDefined(); // batchDelete
    expect(paths['/batch/restore']?.post).toBeDefined();
    expect(paths['/batch/upsert']?.post).toBeDefined();
    expect(paths['/search']?.get).toBeDefined();
    expect(paths['/aggregate']?.get).toBeDefined();
    expect(paths['/export']?.get).toBeDefined();
    expect(paths['/import']?.post).toBeDefined();
    expect(paths['/upsert']?.post).toBeDefined();
    // Item routes
    expect(paths['/{id}']?.get).toBeDefined(); // read
    expect(paths['/{id}']?.patch).toBeDefined(); // update
    expect(paths['/{id}']?.delete).toBeDefined(); // delete
    expect(paths['/{id}/restore']?.post).toBeDefined();
    expect(paths['/{id}/clone']?.post).toBeDefined();
  });

  it('create op has a requestBody schema derived from the model', () => {
    const paths = toOpenApiPaths(fullEndpoints());
    const post = paths['/'].post as {
      requestBody: {
        content: { 'application/json': { schema: Record<string, unknown> } };
      };
    };
    const schema = post.requestBody.content['application/json'].schema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.type).toBe('object');
    // Model fields minus the primary key (id) flow into the create body.
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['inStock', 'name', 'price', 'sku'].sort()
    );
    expect(schema.properties).not.toHaveProperty('id');
    // `name` is .min(1) and non-optional => required; `inStock` has a
    // default => not required.
    expect(schema.required).toContain('name');
    expect(schema.required).not.toContain('inStock');
  });

  it('list op response carries the pagination/result envelope', () => {
    const paths = toOpenApiPaths(fullEndpoints());
    const get = paths['/'].get as {
      responses: Record<
        string,
        { content: { 'application/json': { schema: Record<string, unknown> } } }
      >;
    };
    const ok = get.responses['200'].content['application/json'].schema as {
      type: string;
      properties: Record<string, { type?: string }>;
    };
    expect(ok.type).toBe('object');
    expect(ok.properties).toHaveProperty('success');
    expect(ok.properties).toHaveProperty('result');
    expect(ok.properties).toHaveProperty('result_info');
    // result is the array of model rows.
    expect(ok.properties.result.type).toBe('array');
  });

  it('returns plain JSON-serializable objects (no Zod instances leak)', () => {
    const paths = toOpenApiPaths(fullEndpoints());
    // Round-trips cleanly — proves the values are pure JSON.
    expect(() => JSON.stringify(paths)).not.toThrow();
    const round = JSON.parse(JSON.stringify(paths));
    expect(round['/'].post.requestBody).toBeDefined();
  });

  it('returns an empty object when no endpoints are generated', () => {
    const empty = defineEndpoints({ meta: productMeta }, MemoryAdapters);
    expect(toOpenApiPaths(empty)).toEqual({});
  });
});

// ============================================================================
// 2. basePath prefixing + slash normalization.
// ============================================================================

describe('toOpenApiPaths — basePath', () => {
  it('prefixes basePath onto every path key', () => {
    const paths = toOpenApiPaths(fullEndpoints(), { basePath: '/api/v1/products' });
    expect(paths['/api/v1/products']?.post).toBeDefined();
    expect(paths['/api/v1/products/{id}']?.get).toBeDefined();
    expect(paths['/api/v1/products/search']?.get).toBeDefined();
    expect(paths['/']).toBeUndefined();
  });

  it('normalizes duplicate / leading / trailing slashes', () => {
    const paths = toOpenApiPaths(fullEndpoints(), {
      basePath: '///api//products///',
    });
    expect(paths['/api/products']?.post).toBeDefined();
    expect(paths['/api/products/{id}']?.get).toBeDefined();
    // No double slashes anywhere.
    for (const key of Object.keys(paths)) {
      expect(key).not.toMatch(/\/\//);
      expect(key.startsWith('/')).toBe(true);
      if (key.length > 1) expect(key.endsWith('/')).toBe(false);
    }
  });

  it('defaults basePath to "" (resource-relative keys)', () => {
    const paths = toOpenApiPaths(
      defineEndpoints({ meta: productMeta, list: {} }, MemoryAdapters)
    );
    expect(Object.keys(paths)).toEqual(['/']);
  });
});

// ============================================================================
// 3. tag option override / model tag / tableName fallback.
// ============================================================================

describe('toOpenApiPaths — tag resolution', () => {
  it('falls back to tableName when no model tag / no override', () => {
    const paths = toOpenApiPaths(
      defineEndpoints({ meta: productMeta, list: {} }, MemoryAdapters)
    );
    const get = paths['/'].get as { tags?: string[] };
    expect(get.tags).toEqual(['products']);
  });

  it('uses the model tag when set', () => {
    const taggedModel = defineModel({
      tableName: 'products',
      tag: 'Catalog',
      schema: ProductSchema,
      primaryKeys: ['id'],
    });
    const endpoints = defineEndpoints(
      { meta: defineMeta({ model: taggedModel }), list: {}, create: {} },
      MemoryAdapters
    );
    const paths = toOpenApiPaths(endpoints);
    expect((paths['/'].get as { tags?: string[] }).tags).toEqual(['Catalog']);
    expect((paths['/'].post as { tags?: string[] }).tags).toEqual(['Catalog']);
  });

  it('the tag option overrides per-endpoint / model tags', () => {
    const taggedModel = defineModel({
      tableName: 'products',
      tag: 'Catalog',
      schema: ProductSchema,
      primaryKeys: ['id'],
    });
    const endpoints = defineEndpoints(
      {
        meta: defineMeta({ model: taggedModel }),
        list: { openapi: { tags: ['ExplicitlyTagged'] } },
        create: {},
      },
      MemoryAdapters
    );
    const paths = toOpenApiPaths(endpoints, { tag: 'Override' });
    expect((paths['/'].get as { tags?: string[] }).tags).toEqual(['Override']);
    expect((paths['/'].post as { tags?: string[] }).tags).toEqual(['Override']);
  });

  it('preserves an explicit per-endpoint openapi.tags when no override', () => {
    const endpoints = defineEndpoints(
      {
        meta: productMeta,
        list: { openapi: { tags: ['CustomList'] } },
        create: {},
      },
      MemoryAdapters
    );
    const paths = toOpenApiPaths(endpoints);
    // Explicit per-endpoint tag wins over the model/tableName default.
    expect((paths['/'].get as { tags?: string[] }).tags).toEqual(['CustomList']);
    // Untagged sibling falls back to tableName.
    expect((paths['/'].post as { tags?: string[] }).tags).toEqual(['products']);
  });
});

// ============================================================================
// 4. Disabled endpoints are absent.
// ============================================================================

describe('toOpenApiPaths — disabled endpoints', () => {
  it('omits endpoints not present in the config', () => {
    const endpoints = defineEndpoints(
      { meta: productMeta, list: {}, read: {} },
      MemoryAdapters
    );
    const paths = toOpenApiPaths(endpoints);
    expect(paths['/']?.get).toBeDefined(); // list present
    expect(paths['/']?.post).toBeUndefined(); // create absent
    expect(paths['/{id}']?.get).toBeDefined(); // read present
    expect(paths['/{id}']?.patch).toBeUndefined(); // update absent
    expect(paths['/{id}']?.delete).toBeUndefined(); // delete absent
    expect(paths['/search']).toBeUndefined();
    expect(paths['/batch']).toBeUndefined();
  });
});

// ============================================================================
// 5. Model tag flows into getSchema().tags for a registered endpoint
//    (proves TASK-A independently of toOpenApiPaths).
// ============================================================================

describe('Model.tag flows into endpoint getSchema().tags', () => {
  it('defaults endpoint tags to tableName when model.tag unset', () => {
    const endpoints = defineEndpoints(
      { meta: productMeta, create: {}, list: {} },
      MemoryAdapters
    );
    const create = new endpoints.create!();
    const list = new endpoints.list!();
    expect(create.getSchema().tags).toEqual(['products']);
    expect(list.getSchema().tags).toEqual(['products']);
  });

  it('uses model.tag for every generated endpoint when set', () => {
    const taggedModel = defineModel({
      tableName: 'products',
      tag: 'Inventory',
      schema: ProductSchema,
      primaryKeys: ['id'],
    });
    const endpoints = defineEndpoints(
      { meta: defineMeta({ model: taggedModel }), create: {}, update: {} },
      MemoryAdapters
    );
    expect(new endpoints.create!().getSchema().tags).toEqual(['Inventory']);
    expect(new endpoints.update!().getSchema().tags).toEqual(['Inventory']);
  });

  it('does not override an explicit per-endpoint openapi.tags', () => {
    const taggedModel = defineModel({
      tableName: 'products',
      tag: 'Inventory',
      schema: ProductSchema,
      primaryKeys: ['id'],
    });
    const endpoints = defineEndpoints(
      {
        meta: defineMeta({ model: taggedModel }),
        create: { openapi: { tags: ['Special'] } },
      },
      MemoryAdapters
    );
    expect(new endpoints.create!().getSchema().tags).toEqual(['Special']);
  });
});
