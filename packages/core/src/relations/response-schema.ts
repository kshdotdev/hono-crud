import { type ZodObject, type ZodRawShape, z } from 'zod';

import type { MetaInput, RelationConfig, RelationsConfig } from '../core/types';

/**
 * One result per (item schema, relations, allowed includes). `getSchema()` runs
 * on every request, and each `.openapi(id)` and patched `.extend()` pins a new
 * entry in zod-to-openapi's strong registry, so a fresh schema per call leaks.
 */
type ByIncludes = Map<string, ZodObject<ZodRawShape>>;
const extended = new WeakMap<ZodObject<ZodRawShape>, WeakMap<RelationsConfig, ByIncludes>>();

/**
 * Extend a List/Read/Search/Export response **item** schema with the model's
 * includable relations, so the OpenAPI response documents what
 * `?include=<relation>` returns — and generated typed clients auto-type the
 * embedded related data instead of consumers having to hand-type it.
 *
 * A relation is added only when it is listed in `allowedIncludes` AND declares a
 * `schema` (the related model's shape). The field is always OPTIONAL, since the
 * relation is present only when explicitly requested via `?include=`:
 *   - `hasMany`            → `z.array(relationSchema).optional()`
 *   - `belongsTo` / `hasOne` → `relationSchema.nullable().optional()`, or
 *     `z.union([relationSchema, z.null()]).optional()` for a schema named with
 *     `.meta({ id })`
 *
 * Two emission constraints shape this (zod-to-openapi 8.x):
 *   - A named item schema (`.meta({ id })`) keeps its component `$ref` where it
 *     can (see {@link extendableBase}): it is re-named via `.openapi(id)` before
 *     `.extend()`, the one path zod-to-openapi emits as
 *     `allOf: [{ $ref }, { relations }]`. A plain `.extend()` drops the id and
 *     inlines the row. Not `z.intersection`: Zod's JSON Schema output (MCP
 *     `outputSchema`) closes both allOf branches, rejecting every row.
 *   - A to-one relation over a `.meta({ id })`-named schema is a union with
 *     null, not `.nullable()` (see {@link nullableRelation}).
 *
 * No-op (returns `itemSchema` unchanged) when there are no allowed includes or no
 * included relation declares a `schema`.
 */
export function withIncludableRelations(
  itemSchema: ZodObject<ZodRawShape>,
  meta: MetaInput,
  allowedIncludes: readonly string[],
): ZodObject<ZodRawShape> {
  const relations = meta.model.relations;
  if (!relations || allowedIncludes.length === 0) return itemSchema;

  const byRelations: WeakMap<RelationsConfig, ByIncludes> =
    extended.get(itemSchema) ?? new WeakMap();
  extended.set(itemSchema, byRelations);
  const byIncludes: ByIncludes = byRelations.get(relations) ?? new Map();
  byRelations.set(relations, byIncludes);
  const key = allowedIncludes.join(',');
  const cached = byIncludes.get(key);
  if (cached) return cached;

  // Use Record for mutable shape building (ZodRawShape is readonly in Zod v4).
  const extension: Record<string, z.ZodTypeAny> = {};
  for (const name of allowedIncludes) {
    const relation = relations[name] as RelationConfig | undefined;
    const relationSchema = relation?.schema;
    if (!relationSchema) continue;
    extension[name] =
      relation.type === 'hasMany'
        ? z.array(relationSchema).optional()
        : nullableRelation(relationSchema).optional();
  }
  const result =
    Object.keys(extension).length === 0
      ? itemSchema
      : extendableBase(itemSchema, extension).extend(extension);
  byIncludes.set(key, result);
  return result;
}

/**
 * A to-one relation, null when the related row is missing. `.nullable()` over a
 * schema named with `.meta({ id })` can mark the shared component itself
 * nullable when it is the schema's first use (asteasolutions/zod-to-openapi#258),
 * so such a schema takes a union with null instead. Only `.meta({ id })` names
 * are recognised, not `.openapi('Id')`. Only a named one: the 3.0 generator
 * (`app.doc()`) emits the union's null branch as a bare `{ nullable: true }`,
 * which typed-client generators read as `unknown` (`app.doc31()` emits
 * `{ type: 'null' }`), while `.nullable()` over an inline object stays an exact
 * `{ type: 'object', nullable: true }`.
 */
function nullableRelation(schema: ZodObject<ZodRawShape>): z.ZodType {
  return typeof schema.meta()?.id === 'string' ? z.union([schema, z.null()]) : schema.nullable();
}

/**
 * The item schema to extend: re-named via `.openapi(id)` when its `allOf`
 * emission is sound, otherwise itself (the row inlines, as before #150):
 *   - the row must be named (`.meta({ id })`), or there is no component to reference;
 *   - no relation may share a row field's name: `.extend()` overrides the field,
 *     `allOf` intersects it (`post: string & (Post | null)`), which no row satisfies;
 *   - the row must accept extra fields (no catchall, or an `unknown`/`any` one as
 *     `z.looseObject` / `.passthrough()` set): a `z.strictObject` component's
 *     `additionalProperties: false` rejects the relation fields (and the strict
 *     relation branch rejects the row's own), and a `.catchall(T)` one
 *     requires every relation to match `T` — every such row would fail the doc;
 *   - `.openapi` must exist: `@hono/zod-openapi` adds it only to the Zod instance
 *     it imports, so a row built on a second Zod copy has none to call.
 */
function extendableBase(
  itemSchema: ZodObject<ZodRawShape>,
  extension: Record<string, z.ZodTypeAny>,
): ZodObject<ZodRawShape> {
  const id = itemSchema.meta()?.id;
  const catchall = itemSchema.def.catchall?._zod.def.type;
  const composable =
    typeof id === 'string' &&
    !Object.keys(extension).some((name) => name in itemSchema.shape) &&
    (catchall === undefined || catchall === 'unknown' || catchall === 'any') &&
    typeof itemSchema.openapi === 'function';
  return composable ? itemSchema.openapi(id) : itemSchema;
}
