/**
 * ORM-agnostic relation batch + single-item orchestration. Adapters inject
 * `fetchRelated` (their one-line ORM query) and `resolveRelation` (drizzle:
 * requires `table`; prisma: resolves a model handle; memory: returns the backing
 * Map). The async path uses `PromiseLike`; memory uses a separate sync adapter +
 * sync loader so memory stays fully synchronous.
 */

import type { IncludeOptions, MetaInput, RelationConfig, RelationType } from '../core/types';

/** A loaded related record (opaque to the orchestrator). */
export type RelatedRecord = Record<string, unknown>;

// --- ASYNC adapter (drizzle, prisma) ---
// MUST be PromiseLike, NOT Promise: drizzle's fetchRelated returns a
// QueryBuilder<Row> which `extends PromiseLike<Row[]>` (drizzle helpers.ts:77),
// NOT a Promise — tsc rejects Promise<...> with TS2322 ('missing catch, finally,
// [Symbol.toStringTag]'). The orchestrator only `await`s these, so PromiseLike
// is sufficient.

export type ResolveRelation<Handle> = (
  relationConfig: RelationConfig,
) => Handle | null | PromiseLike<Handle | null>;

export type FetchRelated<Handle> = (
  handle: Handle,
  keyField: string,
  values: unknown[],
) => RelatedRecord[] | PromiseLike<RelatedRecord[]>;

export interface RelationLoaderAdapter<Handle> {
  resolveRelation: ResolveRelation<Handle>;
  fetchRelated: FetchRelated<Handle>;
}

// --- SYNC adapter (memory) ---
// Strictly non-Promise returns so loadRelationsForItemSync runs await-free and
// returns T (not Promise<T>). Memory's crud.ts/advanced.ts call sites stay sync.

export type SyncResolveRelation<Handle> = (relationConfig: RelationConfig) => Handle | null;
export type SyncFetchRelated<Handle> = (
  handle: Handle,
  keyField: string,
  values: unknown[],
) => RelatedRecord[];

export interface SyncRelationLoaderAdapter<Handle> {
  resolveRelation: SyncResolveRelation<Handle>;
  fetchRelated: SyncFetchRelated<Handle>;
}

/** Batch-load all requested relations for `items`, avoiding N+1 by issuing one
 *  `fetchRelated` per relation. Clones items (no input mutation). hasOne/hasMany
 *  group by foreign key, belongsTo maps 1:1 by local key (last-writer-wins). */
export async function batchLoadRelations<
  T extends Record<string, unknown>,
  M extends MetaInput,
  Handle,
>(
  items: T[],
  meta: M,
  adapter: RelationLoaderAdapter<Handle>,
  includeOptions?: IncludeOptions,
): Promise<T[]> {
  if (!items.length || !includeOptions?.relations?.length || !meta.model.relations) {
    return items;
  }
  let results = items.map((item) => ({ ...item })) as T[];

  for (const relationName of includeOptions.relations) {
    const relationConfig = meta.model.relations[relationName] as RelationConfig | undefined;
    if (!relationConfig) continue;
    const handle = await adapter.resolveRelation(relationConfig);
    if (handle == null) continue;

    // VARIANCE LAUNDER (required): RelationLoaderAdapter<Handle> is NOT
    // assignable to RelationLoaderAdapter<unknown> because Handle sits in
    // contravariant position via fetchRelated(handle: Handle, ...). The dispatch
    // map is keyed on RelationType with BatchHandler<unknown>; without the
    // launder tsc emits TS2345. handle is the resolved value (already widened to
    // its concrete type at runtime); cast both through unknown.
    results = await RELATION_BATCH_DISPATCH[relationConfig.type](
      results,
      relationName,
      relationConfig,
      handle as unknown,
      adapter as unknown as RelationLoaderAdapter<unknown>,
    );
  }
  return results;
}

type BatchHandler = <T extends Record<string, unknown>>(
  results: T[],
  relationName: string,
  config: RelationConfig,
  handle: unknown,
  adapter: RelationLoaderAdapter<unknown>,
) => Promise<T[]>;

/** Shared hasOne/hasMany grouping; `single` shapes the map-back. */
function makeHasHandler(single: boolean): BatchHandler {
  return async (results, relationName, config, handle, adapter) => {
    const localKey = config.localKey || 'id';
    const localValues = [
      ...new Set(results.map((i) => i[localKey]).filter((v) => v !== undefined && v !== null)),
    ];
    if (localValues.length === 0) {
      return results.map((i) => ({ ...i, [relationName]: single ? null : [] }));
    }
    const records = await adapter.fetchRelated(handle, config.foreignKey, localValues);
    const byForeignKey = new Map<unknown, RelatedRecord[]>();
    for (const record of records) {
      const fk = record[config.foreignKey];
      const bucket = byForeignKey.get(fk);
      if (bucket) bucket.push(record);
      else byForeignKey.set(fk, [record]);
    }
    return results.map((i) => {
      const related = byForeignKey.get(i[localKey]) || [];
      return { ...i, [relationName]: single ? related[0] || null : related };
    });
  };
}

function makeBelongsToHandler(): BatchHandler {
  return async (results, relationName, config, handle, adapter) => {
    const refLocalKey = config.localKey || 'id';
    const foreignValues = [
      ...new Set(
        results.map((i) => i[config.foreignKey]).filter((v) => v !== undefined && v !== null),
      ),
    ];
    if (foreignValues.length === 0) {
      return results.map((i) => ({ ...i, [relationName]: null }));
    }
    const records = await adapter.fetchRelated(handle, refLocalKey, foreignValues);
    const byLocalKey = new Map<unknown, RelatedRecord>();
    for (const record of records) byLocalKey.set(record[refLocalKey], record); // last-writer-wins
    return results.map((i) => ({
      ...i,
      [relationName]: byLocalKey.get(i[config.foreignKey]) || null,
    }));
  };
}

const RELATION_BATCH_DISPATCH: Record<RelationType, BatchHandler> = {
  hasOne: makeHasHandler(true),
  hasMany: makeHasHandler(false),
  belongsTo: makeBelongsToHandler(),
};

// Map a relation type to its single-item shape via a generic 1-record reducer
// that both async and sync paths reuse. `records` is the (already awaited or
// already plain) fetch result; the reducer is pure & synchronous.
type SingleReducer = (records: RelatedRecord[]) => unknown;
const RELATION_SINGLE_REDUCER: Record<RelationType, SingleReducer> = {
  hasOne: (records) => records[0] ?? null,
  hasMany: (records) => records,
  belongsTo: (records) => records[0] ?? null,
};

// Which key drives the IN-list for a single item, per relation type:
//  - hasOne/hasMany fetch by foreignKey, gated on item[localKey]
//  - belongsTo fetch by localKey, gated on item[foreignKey]
// Returned: { gateValue, keyField } or null when the gate value is null/undefined
// (in which case the reducer is applied to an EMPTY record list — ALWAYS setting
// the key: hasOne/belongsTo -> null, hasMany -> []). This is the unified
// always-set-key behavior (DRIFT #1).
function singleQueryPlan(
  config: RelationConfig,
  item: Record<string, unknown>,
): { gateValue: unknown; keyField: string } | null {
  const localKey = config.localKey || 'id';
  if (config.type === 'belongsTo') {
    const fv = item[config.foreignKey];
    return fv === undefined || fv === null ? null : { gateValue: fv, keyField: localKey };
  }
  const lv = item[localKey];
  return lv === undefined || lv === null ? null : { gateValue: lv, keyField: config.foreignKey };
}

/** Resolve ONE relation for ONE item; returns the relation value (record/array/
 *  null), NOT a merged item. Always-set semantics: when the gate value is null/
 *  undefined, the reducer runs over an empty list. */
export async function resolveRelationValueAsync<Handle>(
  item: Record<string, unknown>,
  config: RelationConfig,
  handle: Handle,
  fetchRelated: FetchRelated<Handle>,
): Promise<unknown> {
  const reducer = RELATION_SINGLE_REDUCER[config.type];
  const plan = singleQueryPlan(config, item);
  if (!plan) return reducer([]);
  const records = await fetchRelated(handle, plan.keyField, [plan.gateValue]);
  return reducer(records);
}

export function resolveRelationValueSync<Handle>(
  item: Record<string, unknown>,
  config: RelationConfig,
  handle: Handle,
  fetchRelated: SyncFetchRelated<Handle>,
): unknown {
  const reducer = RELATION_SINGLE_REDUCER[config.type];
  const plan = singleQueryPlan(config, item);
  if (!plan) return reducer([]);
  const records = fetchRelated(handle, plan.keyField, [plan.gateValue]);
  return reducer(records);
}

/** Load all requested relations for ONE item (async). Always sets the relation
 *  key (hasOne/belongsTo -> record-or-null, hasMany -> array), including when the
 *  gate value is null. Clones the item. */
export async function loadRelationsForItem<
  T extends Record<string, unknown>,
  M extends MetaInput,
  Handle,
>(
  item: T,
  meta: M,
  adapter: RelationLoaderAdapter<Handle>,
  includeOptions?: IncludeOptions,
): Promise<T> {
  if (!includeOptions?.relations?.length || !meta.model.relations) return item;
  const result = { ...item } as Record<string, unknown>;
  for (const relationName of includeOptions.relations) {
    const config = meta.model.relations[relationName] as RelationConfig | undefined;
    if (!config) continue;
    const handle = await adapter.resolveRelation(config);
    if (handle == null) continue;
    result[relationName] = await resolveRelationValueAsync(
      result,
      config,
      handle,
      adapter.fetchRelated,
    );
  }
  return result as T;
}

/** Synchronous variant for memory (no microtask; keeps memory callers sync). */
export function loadRelationsForItemSync<
  T extends Record<string, unknown>,
  M extends MetaInput,
  Handle,
>(
  item: T,
  meta: M,
  adapter: SyncRelationLoaderAdapter<Handle>,
  includeOptions?: IncludeOptions,
): T {
  if (!includeOptions?.relations?.length || !meta.model.relations) return item;
  const result = { ...item } as Record<string, unknown>;
  for (const relationName of includeOptions.relations) {
    const config = meta.model.relations[relationName] as RelationConfig | undefined;
    if (!config) continue;
    const handle = adapter.resolveRelation(config);
    if (handle == null) continue;
    result[relationName] = resolveRelationValueSync(result, config, handle, adapter.fetchRelated);
  }
  return result as T;
}
