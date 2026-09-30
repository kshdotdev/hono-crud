import { type ZodObject, type ZodRawShape, z } from 'zod';

import type { MetaInput, RelationConfig } from '../core/types';

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
 *     `z.union([relationSchema, z.null()]).optional()` for a named schema
 *
 * Two emission constraints shape this (zod-to-openapi 8.x):
 *   - A named item schema (`.meta({ id })`) keeps its component `$ref` where it
 *     can (see {@link extendableBase}): it is re-named via `.openapi(id)` before
 *     `.extend()`, the one path zod-to-openapi emits as
 *     `allOf: [{ $ref }, { relations }]`. A plain `.extend()` drops the id and
 *     inlines the row. Not `z.intersection`: Zod's JSON Schema output (MCP
 *     `outputSchema`) closes both allOf branches, rejecting every row.
 *   - A to-one relation over a named schema is a union with null, not
 *     `.nullable()` (see {@link nullableRelation}).
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
  if (Object.keys(extension).length === 0) return itemSchema;

  return extendableBase(itemSchema).extend(extension);
}

/**
 * A to-one relation, null when the related row is missing. `.nullable()` over a
 * named schema (`.meta({ id })`) can mark the shared component itself nullable
 * when it is the schema's first use (asteasolutions/zod-to-openapi#258), so a
 * named schema takes a union with null instead. Only a named one: the 3.0
 * generator emits the union's null branch as a bare `{ nullable: true }`, which
 * typed-client generators read as `unknown`, while `.nullable()` over an inline
 * object stays an exact `{ type: 'object', nullable: true }`.
 */
function nullableRelation(schema: ZodObject<ZodRawShape>): z.ZodType {
  return typeof schema.meta()?.id === 'string' ? z.union([schema, z.null()]) : schema.nullable();
}

/**
 * The item schema to extend: re-named via `.openapi(id)` when its `allOf`
 * emission is sound, otherwise itself (the row inlines, as before #150):
 *   - the row must be named (`.meta({ id })`), or there is no component to reference;
 *   - the row must be open (no catchall): a `z.strictObject` component's
 *     `additionalProperties: false` rejects the relation fields (and the strict
 *     relation branch rejects the row's own), and a `.catchall(T)` one
 *     requires every relation to match `T` — every such row would fail the doc;
 *   - `.openapi` must exist: `@hono/zod-openapi` adds it only to the Zod instance
 *     it imports, so a row built on a second Zod copy has none to call.
 */
function extendableBase(itemSchema: ZodObject<ZodRawShape>): ZodObject<ZodRawShape> {
  const id = itemSchema.meta()?.id;
  const composable =
    typeof id === 'string' &&
    itemSchema.def.catchall === undefined &&
    typeof itemSchema.openapi === 'function';
  return composable ? itemSchema.openapi(id) : itemSchema;
}
