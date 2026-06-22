// Unit tests for the ORM-agnostic relation batch/single-item orchestrator
// (`packages/core/src/relations/batch-loader.ts`), exercised through the
// `hono-crud/internal` entrypoint with fake adapters. These cover batch
// grouping/map-back, single-item parity, the §D.1 always-set-key drift surface,
// and the exported single-relation primitives.
//
// (Spec §E names this file `relation-batch-loader.test.ts`; this work package's
// scope names it `relation-orchestrator.test.ts` — same suite, kept here.)
import type { MetaInput, RelationConfig, RelationsConfig } from 'hono-crud';
import {
  type FetchRelated,
  type RelatedRecord,
  type RelationLoaderAdapter,
  type SyncFetchRelated,
  type SyncRelationLoaderAdapter,
  batchLoadRelations,
  loadRelationsForItem,
  loadRelationsForItemSync,
  resolveRelationValueAsync,
  resolveRelationValueSync,
} from 'hono-crud/internal';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The orchestrator's generic returns `T` (the input item type). Typing item
// fixtures as an open record lets the tests read the dynamically-added relation
// keys (`posts`, `author`, …) off the result without `any` — the orchestrator's
// own `T extends Record<string, unknown>` constraint is exactly this shape.
type Row = Record<string, unknown>;

// A minimal MetaInput whose only orchestrator-relevant content is
// `model.relations`. The schema/primaryKeys are required by the type but unused
// by the loader.
function metaWith(relations: RelationsConfig): MetaInput {
  return {
    model: {
      tableName: 'users',
      schema: z.object({ id: z.string() }),
      primaryKeys: ['id'],
      relations,
    },
  };
}

// A fake fetchRelated that records every invocation's (keyField, values) and
// returns canned records (filtered to those whose keyField is in `values`,
// mirroring a real IN-list query). `handle` is an opaque sentinel string.
function makeFakeFetch(records: RelatedRecord[]): {
  fetch: FetchRelated<string> & SyncFetchRelated<string>;
  calls: Array<{ handle: string; keyField: string; values: unknown[] }>;
} {
  const calls: Array<{ handle: string; keyField: string; values: unknown[] }> = [];
  const fetch = (handle: string, keyField: string, values: unknown[]): RelatedRecord[] => {
    calls.push({ handle, keyField, values });
    return records.filter((r) => values.includes(r[keyField]));
  };
  return { fetch, calls };
}

function asyncAdapter(
  fetch: FetchRelated<string>,
  handle: string | null = 'HANDLE',
): RelationLoaderAdapter<string> {
  return { resolveRelation: () => handle, fetchRelated: fetch };
}

function syncAdapter(
  fetch: SyncFetchRelated<string>,
  handle: string | null = 'HANDLE',
): SyncRelationLoaderAdapter<string> {
  return { resolveRelation: () => handle, fetchRelated: fetch };
}

const hasMany = (overrides: Partial<RelationConfig> = {}): RelationConfig => ({
  type: 'hasMany',
  model: 'posts',
  foreignKey: 'authorId',
  ...overrides,
});
const hasOne = (overrides: Partial<RelationConfig> = {}): RelationConfig => ({
  type: 'hasOne',
  model: 'profiles',
  foreignKey: 'userId',
  ...overrides,
});
const belongsTo = (overrides: Partial<RelationConfig> = {}): RelationConfig => ({
  type: 'belongsTo',
  model: 'users',
  foreignKey: 'authorId',
  localKey: 'id',
  ...overrides,
});

// ---------------------------------------------------------------------------
// batchLoadRelations
// ---------------------------------------------------------------------------

describe('batchLoadRelations', () => {
  it('hasMany groups 1:N by foreign key', async () => {
    const posts: RelatedRecord[] = [
      { id: 'p1', authorId: 'u1' },
      { id: 'p2', authorId: 'u1' },
      { id: 'p3', authorId: 'u2' },
    ];
    const { fetch, calls } = makeFakeFetch(posts);
    const items: Row[] = [{ id: 'u1' }, { id: 'u2' }];

    const result = await batchLoadRelations(
      items,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      { relations: ['posts'] },
    );

    expect(result[0].posts).toEqual([
      { id: 'p1', authorId: 'u1' },
      { id: 'p2', authorId: 'u1' },
    ]);
    expect(result[1].posts).toEqual([{ id: 'p3', authorId: 'u2' }]);
    // One fetch for the whole batch (N+1 avoidance), keyed on the foreign key.
    expect(calls).toHaveLength(1);
    expect(calls[0].keyField).toBe('authorId');
    expect(calls[0].values).toEqual(['u1', 'u2']);
  });

  it('hasMany with no matches yields []', async () => {
    const { fetch } = makeFakeFetch([]);
    const items: Row[] = [{ id: 'u1' }];
    const result = await batchLoadRelations(
      items,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      { relations: ['posts'] },
    );
    expect(result[0].posts).toEqual([]);
  });

  it('hasOne maps to records[0] || null', async () => {
    const profiles: RelatedRecord[] = [
      { id: 'pr1', userId: 'u1' },
      { id: 'pr2', userId: 'u2' },
    ];
    const { fetch } = makeFakeFetch(profiles);
    const items: Row[] = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
    const result = await batchLoadRelations(
      items,
      metaWith({ profile: hasOne() }),
      asyncAdapter(fetch),
      { relations: ['profile'] },
    );

    expect(result[0].profile).toEqual({ id: 'pr1', userId: 'u1' });
    expect(result[1].profile).toEqual({ id: 'pr2', userId: 'u2' });
    expect(result[2].profile).toBeNull(); // no match → null
  });

  it('belongsTo maps 1:1 by local key with last-writer-wins on duplicates', async () => {
    // Two records share the same localKey ('id') → last one wins.
    const authors: RelatedRecord[] = [
      { id: 'a1', name: 'first' },
      { id: 'a1', name: 'second' },
    ];
    const { fetch, calls } = makeFakeFetch(authors);
    const items: Row[] = [{ id: 'post1', authorId: 'a1' }];

    const result = await batchLoadRelations(
      items,
      metaWith({ author: belongsTo() }),
      asyncAdapter(fetch),
      { relations: ['author'] },
    );

    expect(result[0].author).toEqual({ id: 'a1', name: 'second' }); // last writer wins
    expect(calls[0].keyField).toBe('id'); // belongsTo fetches by localKey
    expect(calls[0].values).toEqual(['a1']);
  });

  it('belongsTo with null/undefined foreign values → all null, fetch NOT called', async () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'a1' }]);
    const items: Row[] = [{ id: 'post1', authorId: null }, { id: 'post2' }];

    const result = await batchLoadRelations(
      items,
      metaWith({ author: belongsTo() }),
      asyncAdapter(fetch),
      { relations: ['author'] },
    );

    expect(result[0].author).toBeNull();
    expect(result[1].author).toBeNull();
    expect(calls).toHaveLength(0); // empty foreignValues → no query
  });

  it('returns items unchanged for empty input', async () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    const result = await batchLoadRelations(
      [],
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      { relations: ['posts'] },
    );
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('de-dupes and filters null/undefined local values before fetching', async () => {
    const { fetch, calls } = makeFakeFetch([]);
    const items = [
      { id: 'u1' },
      { id: 'u1' }, // duplicate
      { id: null }, // filtered
      { id: undefined }, // filtered
      { id: 'u2' },
    ];

    await batchLoadRelations(items, metaWith({ posts: hasMany() }), asyncAdapter(fetch), {
      relations: ['posts'],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual(['u1', 'u2']); // de-duped, non-null only
  });

  it('skips a relation whose resolveRelation returns null while loading the rest', async () => {
    const posts: RelatedRecord[] = [{ id: 'p1', authorId: 'u1' }];
    const { fetch } = makeFakeFetch(posts);
    // Adapter resolves `null` for "profile" but a real handle for "posts".
    const adapter: RelationLoaderAdapter<string> = {
      resolveRelation: (config) => (config.type === 'hasOne' ? null : 'HANDLE'),
      fetchRelated: fetch,
    };

    const items: Row[] = [{ id: 'u1' }];
    const result = await batchLoadRelations(
      items,
      metaWith({ posts: hasMany(), profile: hasOne() }),
      adapter,
      { relations: ['posts', 'profile'] },
    );

    expect(result[0].posts).toEqual([{ id: 'p1', authorId: 'u1' }]);
    expect('profile' in result[0]).toBe(false); // skipped → key not set
  });

  it('skips an unknown relation name (no config) without error', async () => {
    const { fetch, calls } = makeFakeFetch([]);
    const result = await batchLoadRelations(
      [{ id: 'u1' }],
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      { relations: ['nonexistent'] },
    );
    expect('nonexistent' in result[0]).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('does not mutate the input items (clones)', async () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    const items: Row[] = [{ id: 'u1' }];

    const result = await batchLoadRelations(
      items,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      {
        relations: ['posts'],
      },
    );

    expect(items[0]).toEqual({ id: 'u1' }); // original untouched
    expect('posts' in items[0]).toBe(false);
    expect(result[0]).not.toBe(items[0]); // distinct clone
  });

  it('handles a combined belongsTo + hasMany + hasOne over the same item set', async () => {
    const items: Row[] = [{ id: 'u1', orgId: 'o1' }];
    // hasMany posts (by authorId), hasOne profile (by userId), belongsTo org (by id).
    const records: RelatedRecord[] = [
      { id: 'p1', authorId: 'u1' },
      { id: 'pr1', userId: 'u1' },
      { id: 'o1', name: 'Acme' },
    ];
    const { fetch } = makeFakeFetch(records);

    const result = await batchLoadRelations(
      items,
      metaWith({
        posts: hasMany(),
        profile: hasOne(),
        org: belongsTo({ model: 'orgs', foreignKey: 'orgId', localKey: 'id' }),
      }),
      asyncAdapter(fetch),
      { relations: ['posts', 'profile', 'org'] },
    );

    expect(result[0].posts).toEqual([{ id: 'p1', authorId: 'u1' }]);
    expect(result[0].profile).toEqual({ id: 'pr1', userId: 'u1' });
    expect(result[0].org).toEqual({ id: 'o1', name: 'Acme' });
  });
});

// ---------------------------------------------------------------------------
// loadRelationsForItem (async single-item)
// ---------------------------------------------------------------------------

describe('loadRelationsForItem (async single)', () => {
  it('matches batch output for a 1-item case', async () => {
    const posts: RelatedRecord[] = [
      { id: 'p1', authorId: 'u1' },
      { id: 'p2', authorId: 'u1' },
    ];
    const { fetch } = makeFakeFetch(posts);
    const item: Row = { id: 'u1' };

    const single = await loadRelationsForItem(
      item,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      {
        relations: ['posts'],
      },
    );
    const { fetch: fetch2 } = makeFakeFetch(posts);
    const [batched] = await batchLoadRelations(
      [item],
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch2),
      {
        relations: ['posts'],
      },
    );

    expect(single).toEqual(batched);
  });

  it('always sets the key on a null gate value (DRIFT #1): hasOne→null, hasMany→[], belongsTo→null', async () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'x' }]);
    // hasOne/hasMany gate on item[localKey] (id); belongsTo gates on item[foreignKey] (authorId).
    const item: Row = { id: null, authorId: null };

    const result = await loadRelationsForItem(
      item,
      metaWith({ profile: hasOne(), posts: hasMany(), author: belongsTo() }),
      asyncAdapter(fetch),
      { relations: ['profile', 'posts', 'author'] },
    );

    expect(result.profile).toBeNull();
    expect(result.posts).toEqual([]);
    expect(result.author).toBeNull();
    // All gates were null → no fetch issued.
    expect(calls).toHaveLength(0);
  });

  it('belongsTo with null id but populated foreignKey still sets the key (DRIFT #1c)', async () => {
    const authors: RelatedRecord[] = [{ id: 'a1', name: 'Author' }];
    const { fetch, calls } = makeFakeFetch(authors);
    // id is null (would have suppressed the key under the old memory guard) but
    // belongsTo gates on foreignKey (authorId), which is populated.
    const item: Row = { id: null, authorId: 'a1' };

    const result = await loadRelationsForItem(
      item,
      metaWith({ author: belongsTo() }),
      asyncAdapter(fetch),
      {
        relations: ['author'],
      },
    );

    expect(result.author).toEqual({ id: 'a1', name: 'Author' });
    expect(calls[0].keyField).toBe('id'); // belongsTo fetches by localKey
    expect(calls[0].values).toEqual(['a1']); // gated on foreignKey value
  });

  it('returns the item unchanged when no relations requested', async () => {
    const { fetch } = makeFakeFetch([]);
    const item = { id: 'u1' };
    const out = await loadRelationsForItem(
      item,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      {
        relations: [],
      },
    );
    expect(out).toBe(item); // early return, same reference
  });

  it('does not mutate the input item (clones) when relations load', async () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    const item = { id: 'u1' };
    const out = await loadRelationsForItem(
      item,
      metaWith({ posts: hasMany() }),
      asyncAdapter(fetch),
      {
        relations: ['posts'],
      },
    );
    expect('posts' in item).toBe(false);
    expect(out).not.toBe(item);
  });
});

// ---------------------------------------------------------------------------
// loadRelationsForItemSync (synchronous, memory)
// ---------------------------------------------------------------------------

describe('loadRelationsForItemSync', () => {
  it('returns a plain (non-thenable) value — runs synchronously', () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    const item: Row = { id: 'u1' };
    const out = loadRelationsForItemSync(item, metaWith({ posts: hasMany() }), syncAdapter(fetch), {
      relations: ['posts'],
    });
    // Not a Promise: no `.then`.
    expect((out as { then?: unknown }).then).toBeUndefined();
    expect(out.posts).toEqual([{ id: 'p1', authorId: 'u1' }]);
  });

  it('always sets the key on null gate values (DRIFT #1) just like the async path', () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'x' }]);
    const item: Row = { id: null, authorId: null };

    const result = loadRelationsForItemSync(
      item,
      metaWith({ profile: hasOne(), posts: hasMany(), author: belongsTo() }),
      syncAdapter(fetch),
      { relations: ['profile', 'posts', 'author'] },
    );

    expect(result.profile).toBeNull();
    expect(result.posts).toEqual([]);
    expect(result.author).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('belongsTo with null id but populated foreignKey sets the key (memory DRIFT #1c)', () => {
    const { fetch } = makeFakeFetch([{ id: 'a1', name: 'Author' }]);
    const item: Row = { id: null, authorId: 'a1' };

    const result = loadRelationsForItemSync(
      item,
      metaWith({ author: belongsTo() }),
      syncAdapter(fetch),
      {
        relations: ['author'],
      },
    );

    expect(result.author).toEqual({ id: 'a1', name: 'Author' });
  });

  it('skips a relation whose resolveRelation returns null', () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    const adapter: SyncRelationLoaderAdapter<string> = {
      resolveRelation: (config) => (config.type === 'hasOne' ? null : 'HANDLE'),
      fetchRelated: fetch,
    };
    const item: Row = { id: 'u1' };
    const result = loadRelationsForItemSync(
      item,
      metaWith({ posts: hasMany(), profile: hasOne() }),
      adapter,
      { relations: ['posts', 'profile'] },
    );
    expect(result.posts).toEqual([{ id: 'p1', authorId: 'u1' }]);
    expect('profile' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exported single-relation primitives
// ---------------------------------------------------------------------------

describe('resolveRelationValueAsync', () => {
  it('hasMany: returns the records array; fetches by foreignKey gated on localKey', async () => {
    const { fetch, calls } = makeFakeFetch([
      { id: 'p1', authorId: 'u1' },
      { id: 'p2', authorId: 'u1' },
    ]);
    const value = await resolveRelationValueAsync({ id: 'u1' }, hasMany(), 'HANDLE', fetch);

    expect(value).toEqual([
      { id: 'p1', authorId: 'u1' },
      { id: 'p2', authorId: 'u1' },
    ]);
    expect(calls[0].keyField).toBe('authorId');
    expect(calls[0].values).toEqual(['u1']);
  });

  it('hasOne: returns records[0] ?? null', async () => {
    const { fetch } = makeFakeFetch([{ id: 'pr1', userId: 'u1' }]);
    const value = await resolveRelationValueAsync({ id: 'u1' }, hasOne(), 'HANDLE', fetch);
    expect(value).toEqual({ id: 'pr1', userId: 'u1' });

    const { fetch: emptyFetch } = makeFakeFetch([]);
    expect(
      await resolveRelationValueAsync({ id: 'u9' }, hasOne(), 'HANDLE', emptyFetch),
    ).toBeNull();
  });

  it('belongsTo: fetches by localKey gated on foreignKey, returns records[0] ?? null', async () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'a1', name: 'Author' }]);
    const value = await resolveRelationValueAsync(
      { id: 'post1', authorId: 'a1' },
      belongsTo(),
      'HANDLE',
      fetch,
    );

    expect(value).toEqual({ id: 'a1', name: 'Author' });
    expect(calls[0].keyField).toBe('id'); // localKey
    expect(calls[0].values).toEqual(['a1']); // gated on foreignKey value
  });

  it('null gate value runs the reducer over an empty list (no fetch)', async () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'x' }]);

    expect(await resolveRelationValueAsync({ id: null }, hasOne(), 'HANDLE', fetch)).toBeNull();
    expect(await resolveRelationValueAsync({ id: null }, hasMany(), 'HANDLE', fetch)).toEqual([]);
    expect(
      await resolveRelationValueAsync({ authorId: null }, belongsTo(), 'HANDLE', fetch),
    ).toBeNull();
    expect(calls).toHaveLength(0); // gated → reducer over [] without fetching
  });
});

describe('resolveRelationValueSync', () => {
  it('returns the same shapes as the async primitive, synchronously', () => {
    const { fetch: f1 } = makeFakeFetch([{ id: 'p1', authorId: 'u1' }]);
    expect(resolveRelationValueSync({ id: 'u1' }, hasMany(), 'HANDLE', f1)).toEqual([
      { id: 'p1', authorId: 'u1' },
    ]);

    const { fetch: f2 } = makeFakeFetch([{ id: 'pr1', userId: 'u1' }]);
    expect(resolveRelationValueSync({ id: 'u1' }, hasOne(), 'HANDLE', f2)).toEqual({
      id: 'pr1',
      userId: 'u1',
    });

    const { fetch: f3 } = makeFakeFetch([{ id: 'a1' }]);
    expect(resolveRelationValueSync({ authorId: 'a1' }, belongsTo(), 'HANDLE', f3)).toEqual({
      id: 'a1',
    });
  });

  it('null gate value → reducer over empty list, no fetch', () => {
    const { fetch, calls } = makeFakeFetch([{ id: 'x' }]);
    expect(resolveRelationValueSync({ id: null }, hasOne(), 'HANDLE', fetch)).toBeNull();
    expect(resolveRelationValueSync({ id: null }, hasMany(), 'HANDLE', fetch)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Owner-scoped includes — `RelationConfig.scope` + `IncludeOptions.scope`
//
// Security: `?include=` must not expose a related row the caller can't read.
// The orchestrator filters fetched related rows by the related table's owner
// column (scoped to the request's tenant id) and soft-delete column BEFORE they
// are mapped back onto the parent — so a foreign-key pointing at another
// tenant's row resolves to null/[] and never reaches the response.
// ---------------------------------------------------------------------------

describe('include scope filtering (owner-scope + soft-delete)', () => {
  // comment belongsTo post; the related post is owner-scoped by `authorId` and
  // soft-deleted via `deletedAt`.
  const scopedPost = belongsTo({
    model: 'posts',
    foreignKey: 'postId',
    localKey: 'id',
    scope: { tenantField: 'authorId', softDeleteField: 'deletedAt' },
  });

  it('belongsTo: a related row owned by another tenant resolves to null', async () => {
    // comment owned by tenant A references a post owned by tenant B.
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'B', deletedAt: null }]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: scopedPost }),
      asyncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(result[0].post).toBeNull();
  });

  it('belongsTo: a related row owned by the same tenant is returned', async () => {
    const post = { id: 'p1', authorId: 'A', deletedAt: null };
    const { fetch } = makeFakeFetch([post]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: scopedPost }),
      asyncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(result[0].post).toEqual(post);
  });

  it('belongsTo: a soft-deleted related row is excluded by default', async () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'A', deletedAt: '2020-01-01' }]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: scopedPost }),
      asyncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(result[0].post).toBeNull();
  });

  it('belongsTo: a soft-deleted related row is kept when includeDeleted', async () => {
    const post = { id: 'p1', authorId: 'A', deletedAt: '2020-01-01' };
    const { fetch } = makeFakeFetch([post]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: scopedPost }),
      asyncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A', includeDeleted: true } },
    );
    expect(result[0].post).toEqual(post);
  });

  it('hasMany: drops related rows in other tenants and soft-deleted ones', async () => {
    const scopedPosts = hasMany({
      model: 'posts',
      foreignKey: 'ownerId', // grouping key (the parent user id)
      scope: { tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    });
    const posts: RelatedRecord[] = [
      { id: 'p1', ownerId: 'u1', tenantId: 'A', deletedAt: null }, // kept
      { id: 'p2', ownerId: 'u1', tenantId: 'B', deletedAt: null }, // other tenant → dropped
      { id: 'p3', ownerId: 'u1', tenantId: 'A', deletedAt: '2020' }, // soft-deleted → dropped
    ];
    const { fetch } = makeFakeFetch(posts);
    const result = await batchLoadRelations(
      [{ id: 'u1' }],
      metaWith({ posts: scopedPosts }),
      asyncAdapter(fetch),
      { relations: ['posts'], scope: { tenantId: 'A' } },
    );
    expect(result[0].posts).toEqual([{ id: 'p1', ownerId: 'u1', tenantId: 'A', deletedAt: null }]);
  });

  it('no-op when the relation declares no scope (backward compatible)', async () => {
    const post = { id: 'p1', authorId: 'B', deletedAt: '2020' };
    const { fetch } = makeFakeFetch([post]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: belongsTo({ foreignKey: 'postId', localKey: 'id' }) }),
      asyncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(result[0].post).toEqual(post); // unscoped relation → unfiltered
  });

  it('no-op when the request carries no scope (backward compatible)', async () => {
    const post = { id: 'p1', authorId: 'B', deletedAt: '2020' };
    const { fetch } = makeFakeFetch([post]);
    const result = await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: scopedPost }),
      asyncAdapter(fetch),
      { relations: ['post'] }, // no scope on the request
    );
    expect(result[0].post).toEqual(post);
  });

  it('sync path: cross-tenant related row resolves to null', () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'B', deletedAt: null }]);
    const result = loadRelationsForItemSync(
      { id: 'c1', postId: 'p1' },
      metaWith({ post: scopedPost }),
      syncAdapter(fetch),
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(result.post).toBeNull();
  });

  it('single primitive: resolveRelationValueAsync honors the request scope', async () => {
    const { fetch } = makeFakeFetch([{ id: 'p1', authorId: 'B', deletedAt: null }]);
    const value = await resolveRelationValueAsync(
      { id: 'c1', postId: 'p1' },
      scopedPost,
      'HANDLE',
      fetch,
      { tenantId: 'A' },
    );
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fetch-scope push-down — the orchestrator hands the resolved scope to
// `fetchRelated` so adapters can filter in SQL (the orchestrator's post-fetch
// `applyRelationScope` stays as a defense-in-depth net).
// ---------------------------------------------------------------------------

describe('fetch-scope push-down to fetchRelated', () => {
  const scopedRel = belongsTo({
    foreignKey: 'postId',
    localKey: 'id',
    scope: { tenantField: 'authorId', softDeleteField: 'deletedAt' },
  });

  function recordingAdapter() {
    const scopes: unknown[] = [];
    const adapter: RelationLoaderAdapter<string> = {
      resolveRelation: () => 'HANDLE',
      fetchRelated: (_h, _k, _values, scope) => {
        scopes.push(scope);
        return [];
      },
    };
    return { adapter, scopes };
  }

  it('passes the resolved tenant + soft-delete scope', async () => {
    const { adapter, scopes } = recordingAdapter();
    await batchLoadRelations([{ id: 'c1', postId: 'p1' }], metaWith({ post: scopedRel }), adapter, {
      relations: ['post'],
      scope: { tenantId: 'A' },
    });
    expect(scopes[0]).toEqual({
      tenantField: 'authorId',
      tenantValue: 'A',
      excludeDeletedField: 'deletedAt',
    });
  });

  it('drops the soft-delete field when includeDeleted is set', async () => {
    const { adapter, scopes } = recordingAdapter();
    await batchLoadRelations([{ id: 'c1', postId: 'p1' }], metaWith({ post: scopedRel }), adapter, {
      relations: ['post'],
      scope: { tenantId: 'A', includeDeleted: true },
    });
    expect(scopes[0]).toMatchObject({ tenantField: 'authorId', tenantValue: 'A' });
    expect((scopes[0] as { excludeDeletedField?: string }).excludeDeletedField).toBeUndefined();
  });

  it('passes undefined when the relation declares no scope', async () => {
    const { adapter, scopes } = recordingAdapter();
    await batchLoadRelations(
      [{ id: 'c1', postId: 'p1' }],
      metaWith({ post: belongsTo({ foreignKey: 'postId', localKey: 'id' }) }),
      adapter,
      { relations: ['post'], scope: { tenantId: 'A' } },
    );
    expect(scopes[0]).toBeUndefined();
  });
});
