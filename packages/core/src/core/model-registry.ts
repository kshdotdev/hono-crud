/**
 * Eager model-registry factory.
 *
 * `defineModels({...})` lets every cross-referencing model be authored in ONE
 * call, referencing siblings by registry key — so a circular graph
 * (User.relations.posts ↔ Post.relations.author) is inert data: no declaration
 * ordering, no thunks, no hand-duplicated schema/table consts. The factory
 * eagerly, at the call site (strictly before any `registerCrud` /
 * `toOpenApiPaths` reads `relation.schema` inside `getSchema()`):
 *
 *  1. validates each internal relation target against the sibling keys
 *     (aggregating every miss into one setup-time `Error`),
 *  2. auto-populates each relation's `schema` (the sibling's BASE schema —
 *     never an include-aware one, which would recurse under mutual includes)
 *     and `table` (the sibling's `Model.table` reference — what the drizzle
 *     adapter needs; memory/prisma resolve by name and ignore it),
 *  3. rewrites `relation.model` from the registry key to the sibling's
 *     `tableName`, the form the adapters resolve
 *     (memory store key / prisma delegate derivation).
 *
 * Wired models are FRESH objects — author inputs are never mutated — and the
 * output is deterministic per call with no module-global state (edge-safe: a
 * per-isolate module-global registry is exactly what the prisma adapter once
 * had and deleted for silent Workers-isolate divergence).
 *
 * The compile-time sibling-key constraint on `relation.model` is the first
 * line of defence; the runtime validation catches dynamically-built maps that
 * escape static checking. Off-registry targets (cross-package, polymorphic)
 * opt out per relation via `external: true` and author a raw `RelationConfig`.
 */

import type { ZodObject, ZodRawShape } from 'zod';
import type { Model, RelationConfig, RelationsConfig } from './types';

/**
 * A relation authored inside a `defineModels({...})` entry.
 *
 * **Internal form (default):** `model` is constrained to the sibling registry
 * keys, so a typo is a compile error; `schema` and `table` are auto-populated
 * from the target sibling, so you normally omit them. Explicitly-authored
 * `schema`/`table` win (see {@link DefineModelsConfig.overwriteExplicit}).
 *
 * **External form (escape hatch):** set `external: true` to target a model
 * that is NOT a sibling in this call — cross-file, cross-package, or
 * polymorphic. The sibling-key constraint and auto-population are both
 * switched off; you author `model` (any string) and `schema`/`table` exactly
 * as a raw {@link RelationConfig}. The marker is stripped from the wired output.
 */
export type RelationSpec<TSiblingKeys extends string> =
  | (Omit<RelationConfig, 'model' | 'schema' | 'table'> & {
      /** Sibling registry key this relation targets (compile-time typo rejection). */
      model: TSiblingKeys;
      /** Optional explicit schema override (else auto-populated from the sibling). */
      schema?: ZodObject<ZodRawShape>;
      /** Optional explicit table override (else auto-populated from the sibling). */
      table?: unknown;
      external?: false;
    })
  | (RelationConfig & {
      /** Opt out of sibling-key checking + auto-population for an off-registry target. */
      external: true;
    });

/**
 * One registry entry as authored: the existing {@link Model} config, except
 * relation values reference siblings by key ({@link RelationSpec}).
 */
export type ModelSpec<
  TSiblingKeys extends string,
  T extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>,
  TTable = unknown,
> = Omit<Model<T, TTable, RelationsConfig>, 'relations'> & {
  relations?: Record<string, RelationSpec<TSiblingKeys>>;
};

/**
 * Setup bag for {@link defineModels}. The defaults close the silent gaps that
 * hand-authored relation configs accumulate (missing `schema` → the relation
 * is omitted from OpenAPI include/nested-write shapes; missing `table` → the
 * drizzle include silently no-ops).
 */
export interface DefineModelsConfig {
  /**
   * Back-fill `relation.schema` from the target sibling's BASE `Model.schema`.
   * Affects OpenAPI include-response shapes AND nested-write request-body
   * validation for allow-listed relations.
   * @default true
   */
  autoPopulateSchema?: boolean;
  /**
   * Back-fill `relation.table` with the target sibling's `Model.table`
   * reference (the drizzle Table object; memory/prisma resolve by name).
   * @default true
   */
  autoPopulateTable?: boolean;
  /**
   * Overwrite explicitly-authored `schema`/`table` with the sibling's values.
   * @default false — the author's explicit value wins.
   */
  overwriteExplicit?: boolean;
  /**
   * Unknown internal relation target: `'throw'` aggregates every miss into ONE
   * setup-time `Error` (with a did-you-mean suggestion); `'ignore'` leaves the
   * relation unresolved, for incrementally/dynamically built maps.
   * @default 'throw'
   */
  onUnknownModel?: 'throw' | 'ignore';
  /**
   * Freeze the returned models, their `relations` containers, and each wired
   * relation config (schemas/tables are left unfrozen). Guards against
   * accidental post-wiring mutation on shared edge isolates.
   * @default false
   */
  freeze?: boolean;
}

/**
 * Normalize an entry's relation values to bare {@link RelationConfig} while
 * preserving the literal relation-name keys — exactly `defineModel`'s
 * return-type normalization, hand-reproduced because the factory consumes raw
 * specs rather than `defineModel` output.
 */
type WiredRelations<E> = E extends { relations?: infer R }
  ? [R] extends [object]
    ? { [K in keyof R & string]: RelationConfig }
    : RelationsConfig
  : RelationsConfig;

/**
 * The wired {@link Model} produced for one entry — concrete `schema`/`table`
 * generics preserved, relations normalized (literal keys, bare values).
 */
export type WiredModel<E> = E extends {
  schema: infer T extends ZodObject<ZodRawShape>;
  table?: infer TTable;
}
  ? Model<T, TTable, WiredRelations<E>>
  : E extends { schema: infer T extends ZodObject<ZodRawShape> }
    ? Model<T, unknown, WiredRelations<E>>
    : never;

/** The wired output map: each key preserves its narrow {@link WiredModel}. */
export type WiredModels<TMap> = { [K in keyof TMap]: WiredModel<TMap[K]> };

/** Re-extract an entry's own concrete Zod schema for its schema-key checks. */
type SchemaOf<E> = E extends { schema: infer S extends ZodObject<ZodRawShape> }
  ? S
  : ZodObject<ZodRawShape>;

/** Re-extract an entry's own concrete table type for its override typing. */
type TableOf<E> = E extends { table?: infer TTable } ? TTable : unknown;

/** One unresolved internal relation target, for the aggregated setup error. */
interface UnknownTarget {
  modelKey: string;
  relationName: string;
  target: string;
}

/** Classic two-row Levenshtein distance (sync, allocation-light). */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** Closest registry key to `target`, when close enough to be a likely typo. */
function suggestRegistryKey(target: string, knownKeys: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of knownKeys) {
    const distance = levenshteinDistance(target.toLowerCase(), key.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(target.length / 2)) ? best : undefined;
}

/** Aggregated, suggestion-bearing message for every unknown internal target. */
function formatUnknownTargets(
  misses: readonly UnknownTarget[],
  knownKeys: readonly string[],
): string {
  const details = misses
    .map(({ modelKey, relationName, target }) => {
      const suggestion = suggestRegistryKey(target, knownKeys);
      const hint = suggestion ? ` (did you mean '${suggestion}'?)` : '';
      return `${modelKey}.relations.${relationName} → '${target}'${hint}`;
    })
    .join('; ');
  return `defineModels: unknown relation target(s): ${details}. Known registry keys: ${knownKeys.join(', ')}. Add the target model to this defineModels call, or mark the relation \`external: true\` and author its schema/table explicitly.`;
}

/** {@link DefineModelsConfig} with every default applied. */
interface ResolvedDefineModelsConfig {
  autoPopulateSchema: boolean;
  autoPopulateTable: boolean;
  overwriteExplicit: boolean;
  onUnknownModel: 'throw' | 'ignore';
  freeze: boolean;
}

/** An authored relation value before the `external` marker is stripped. */
type AuthoredRelation = RelationConfig & { external?: boolean };

/**
 * Validation sweep: every internal relation target that is neither a same-call
 * sibling key nor a base-map key. Runs to completion BEFORE any wiring so a
 * bad map never yields a half-wired graph and every miss surfaces in one error.
 */
function collectUnknownTargets(
  wired: Record<string, Model>,
  base: Record<string, Model>,
): UnknownTarget[] {
  const misses: UnknownTarget[] = [];
  for (const [modelKey, model] of Object.entries(wired)) {
    for (const [relationName, authored] of Object.entries(model.relations ?? {})) {
      const spec = authored as AuthoredRelation;
      if (spec.external === true) continue;
      if (!Object.hasOwn(wired, spec.model) && !Object.hasOwn(base, spec.model)) {
        misses.push({ modelKey, relationName, target: spec.model });
      }
    }
  }
  return misses;
}

/**
 * Own-property sibling lookup (same-call siblings shadow base-map keys).
 * `Object.hasOwn` guards both maps so an unresolved target that collides with
 * an `Object.prototype` member (e.g. `'constructor'` under
 * `onUnknownModel: 'ignore'`) is never wired against the prototype.
 */
function lookupSibling(
  key: string,
  wired: Record<string, Model>,
  base: Record<string, Model>,
): Model | undefined {
  if (Object.hasOwn(wired, key)) return wired[key];
  if (Object.hasOwn(base, key)) return base[key];
  return undefined;
}

/**
 * Wire one relation: fresh object (author input never mutated), sibling
 * auto-population, and the registry-key → tableName rewrite. Same-call
 * siblings shadow base-map keys. External relations pass through untouched
 * apart from the stripped marker.
 */
function wireRelation(
  authored: AuthoredRelation,
  wired: Record<string, Model>,
  base: Record<string, Model>,
  config: ResolvedDefineModelsConfig,
): RelationConfig {
  const { external, ...relation } = authored;
  const sibling = external === true ? undefined : lookupSibling(relation.model, wired, base);
  if (!sibling) return relation;
  if (config.autoPopulateSchema && (config.overwriteExplicit || relation.schema == null)) {
    relation.schema = sibling.schema;
  }
  const tableUnset = config.overwriteExplicit || relation.table == null;
  if (config.autoPopulateTable && tableUnset && sibling.table != null) {
    relation.table = sibling.table;
  }
  relation.model = sibling.tableName;
  return relation;
}

/** Freeze wired models, their relations containers, and each relation config. */
function freezeWiredModels(wired: Record<string, Model>): void {
  for (const model of Object.values(wired)) {
    if (model.relations) {
      for (const relation of Object.values(model.relations)) Object.freeze(relation);
      Object.freeze(model.relations);
    }
    Object.freeze(model);
  }
}

/**
 * Author every cross-referencing model in ONE call. Sibling references are
 * registry keys, so circular graphs need no ordering games, and each
 * relation's `schema`/`table` is auto-populated from its target (see
 * {@link DefineModelsConfig} for the knobs). Returns fully-wired, fresh
 * {@link Model} objects ready for `defineMeta`.
 *
 * Setup-time validation failures throw a plain `Error` (fail-fast at boot,
 * per the error-split doctrine) aggregating every unknown target at once.
 *
 * @example
 * ```ts
 * const db = defineModels({
 *   users: {
 *     tableName: 'users', schema: UserSchema, primaryKeys: ['id'],
 *     relations: { posts: { type: 'hasMany', model: 'posts', foreignKey: 'authorId' } },
 *   },
 *   posts: {
 *     tableName: 'posts', schema: PostSchema, primaryKeys: ['id'],
 *     relations: { author: { type: 'belongsTo', model: 'users', foreignKey: 'authorId' } },
 *   },
 * });
 * const userMeta = defineMeta({ model: db.users });
 * // db.users.relations.posts.schema === PostSchema (auto-populated)
 * ```
 */
export function defineModels<
  TMap extends {
    [K in keyof TMap]: ModelSpec<Extract<keyof TMap, string>, SchemaOf<TMap[K]>, TableOf<TMap[K]>>;
  },
>(map: TMap, config: DefineModelsConfig = {}): WiredModels<TMap> {
  return wireModelMap(map, {}, resolveDefineModelsConfig(config)) as WiredModels<TMap>;
}

/**
 * Setup bag for {@link defineModelsExtending} — the {@link DefineModelsConfig}
 * knobs plus the base map whose keys become referenceable siblings.
 */
export interface DefineModelsExtendConfig<TBase extends Record<string, Model>>
  extends DefineModelsConfig {
  /** A previously-wired map whose keys become referenceable siblings. */
  extends: TBase;
}

/**
 * Incremental adoption: wire a new map whose relations may also target the
 * keys of an ALREADY-WIRED base map — composing registries acyclically across
 * files/calls (a true cycle must be co-located in one {@link defineModels}
 * call, which is the point of the mechanism). Same-call siblings shadow base
 * keys; the returned map exposes base entries alongside the new ones, and the
 * base models are never re-wired, mutated, or frozen by this call.
 *
 * @example
 * ```ts
 * const core = defineModels({ users: { ... } });
 * const billing = defineModelsExtending(
 *   { invoices: { ..., relations: { owner: { type: 'belongsTo', model: 'users', foreignKey: 'userId' } } } },
 *   { extends: core },
 * );
 * // billing.invoices.relations.owner.schema === core.users.schema (auto-populated)
 * ```
 */
export function defineModelsExtending<
  TBase extends Record<string, Model>,
  TMap extends {
    [K in keyof TMap]: ModelSpec<
      Extract<keyof TMap | keyof TBase, string>,
      SchemaOf<TMap[K]>,
      TableOf<TMap[K]>
    >;
  },
>(map: TMap, config: DefineModelsExtendConfig<TBase>): WiredModels<TMap> & TBase {
  const { extends: base, ...knobs } = config;
  const wired = wireModelMap(map, base, resolveDefineModelsConfig(knobs));
  return { ...base, ...wired } as WiredModels<TMap> & TBase;
}

/** Apply the {@link DefineModelsConfig} defaults. */
function resolveDefineModelsConfig(config: DefineModelsConfig): ResolvedDefineModelsConfig {
  return {
    autoPopulateSchema: config.autoPopulateSchema ?? true,
    autoPopulateTable: config.autoPopulateTable ?? true,
    overwriteExplicit: config.overwriteExplicit ?? false,
    onUnknownModel: config.onUnknownModel ?? 'throw',
    freeze: config.freeze ?? false,
  };
}

/**
 * The shared wiring core behind {@link defineModels} (empty base) and
 * {@link defineModelsExtending}: copy, validate everything, then wire.
 * Only the NEW map's models are wired (and, with `freeze`, frozen) — base
 * models were already wired by their own producing call.
 */
function wireModelMap(
  map: object,
  base: Record<string, Model>,
  resolved: ResolvedDefineModelsConfig,
): Record<string, Model> {
  // Pass 1 — shallow-copy every entry so author inputs are never mutated.
  // (Runtime parity with defineModel, which is an identity function.)
  const wired: Record<string, Model> = {};
  for (const [key, spec] of Object.entries(map)) {
    wired[key] = { ...(spec as unknown as Model) };
  }

  // Pass 2a — validate EVERY internal relation target before wiring anything.
  const misses = collectUnknownTargets(wired, base);
  if (misses.length > 0 && resolved.onUnknownModel === 'throw') {
    throw new Error(formatUnknownTargets(misses, [...Object.keys(base), ...Object.keys(wired)]));
  }

  // Pass 2b — wire: fresh relation objects, auto-population from the sibling,
  // and the registry-key → tableName rewrite the adapters resolve by.
  for (const model of Object.values(wired)) {
    if (!model.relations) continue;
    const rewired: Record<string, RelationConfig> = {};
    for (const [relationName, authored] of Object.entries(model.relations)) {
      rewired[relationName] = wireRelation(authored as AuthoredRelation, wired, base, resolved);
    }
    model.relations = rewired;
  }

  if (resolved.freeze) freezeWiredModels(wired);

  return wired;
}
